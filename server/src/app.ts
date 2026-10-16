import { randomUUID } from 'node:crypto'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify'
import type { Logger } from 'pino'
import type { BackupDestination } from './config/index.js'
import { canQueryDatabase, type Database } from './db/client.js'
import { getSchemaVersion } from './db/migrate.js'
import { registerAuthHook } from './http/auth-hook.js'
import type { AppContext } from './http/context.js'
import { registerAdjustmentRoutes } from './modules/adjustments/routes.js'
import { registerAuthRoutes } from './modules/auth/routes.js'
import { registerBackupRoutes, type BackupRoutesOptions, type MaintenanceState } from './modules/backup/routes.js'
import { backupHealth } from './modules/backup/service.js'
import { registerCatalogRoutes } from './modules/catalog/routes.js'
import { registerCustomerRoutes } from './modules/customers/routes.js'
import { registerLedgerRoutes } from './modules/ledger/routes.js'
import { registerOrderRoutes } from './modules/orders/routes.js'
import { registerPaymentRoutes } from './modules/payments/routes.js'
import { registerPriceBookRoutes } from './modules/price-book/routes.js'
import { registerReportRoutes } from './modules/reports/routes.js'
import { registerReturnRoutes } from './modules/returns/routes.js'
import { registerSettingsRoutes } from './modules/settings/routes.js'
import { registerSystemRoutes } from './modules/system/routes.js'
import { AppError, codeForStatus, toErrorBody } from './shared/errors.js'
import { registerRequestGuard } from './shared/request-guard.js'

export interface BuildAppOptions {
  port: number
  db: Database
  logger: Logger
  version: string
  /** Injectable clock so session expiry and "today" can be tested. */
  now?: () => Date
  /** Current backup destinations, read on each health check so a drive chosen in Settings counts at once. */
  backupDestinations?: () => readonly BackupDestination[]
  /** Called after any successful write request; lets the backup scheduler know data changed. */
  onDataChanged?: () => void
  /** Enables the in-app backup list, "back up now" and restore. Absent in tests that do not need it. */
  backup?: Omit<BackupRoutesOptions, 'maintenance'>
  /** Folder with the built web app. When set, the server also serves it (single-process install). */
  webRoot?: string
  /** Public https origins when hosted online (see AppConfig.publicOrigins). Empty or absent locally. */
  publicOrigins?: string[]
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
// Logging in or reporting a browser error does not change business data.
const NON_DATA_PATHS = ['/api/auth/', '/api/client-log']

// Only accept a caller-supplied id when it is short and boring, so it is safe to put in logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { db, version } = options
  // `options.logger` is untagged: HTTP request logs are tagged "server" here, while modules tag
  // themselves (auth, backup, web...), so each log line carries exactly one component.
  // Typed as Fastify's logger interface so FastifyInstance stays the plain, un-parameterised type.
  const loggerInstance: FastifyBaseLogger = options.logger.child({ component: 'server' })
  const ctx: AppContext = { db, logger: options.logger, now: options.now ?? (() => new Date()) }
  const hosted = (options.publicOrigins ?? []).length > 0

  const app = Fastify({
    loggerInstance,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: (request) => {
      const supplied = request.headers['x-request-id']
      return typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID()
    },
    bodyLimit: 1024 * 1024,
    // Hosted online, requests arrive through the platform's proxy; trust it for the client IP in logs.
    trustProxy: hosted,
  })

  // Hook order matters: reject foreign hosts/origins first, then read cookies, then authenticate.
  registerRequestGuard(app, { port: options.port, publicOrigins: options.publicOrigins ?? [] })
  await app.register(cookie)
  registerAuthHook(app, ctx)

  // Once a restore is staged the database is about to be swapped; refuse writes (and reads of
  // soon-stale data) until the process has restarted. The health check stays up for the browser to poll.
  const maintenance: MaintenanceState = { restoring: false }
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? ''
    if (maintenance.restoring && path.startsWith('/api/') && path !== '/api/health') {
      throw new AppError('UNAVAILABLE', 'Đang khôi phục dữ liệu, vui lòng đợi vài giây')
    }
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  if (options.onDataChanged) {
    const notify = options.onDataChanged
    app.addHook('onResponse', async (request, reply) => {
      const path = request.url.split('?')[0] ?? ''
      const changesData =
        WRITE_METHODS.has(request.method) &&
        reply.statusCode < 400 &&
        path.startsWith('/api/') &&
        !NON_DATA_PATHS.some((prefix) => path.startsWith(prefix))
      if (changesData) notify()
    })
  }

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code }, error.message)
      return reply.status(error.statusCode).send(toErrorBody(error.code, error.message, error.fields))
    }

    const statusCode = error.statusCode
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      request.log.warn({ statusCode }, error.message)
      return reply.status(statusCode).send(toErrorBody(codeForStatus(statusCode), error.message))
    }

    // Unexpected: keep details in the log, never leak them to the client.
    request.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send(toErrorBody('INTERNAL', 'Đã có lỗi xảy ra, vui lòng thử lại'))
  })

  if (options.webRoot) {
    await app.register(fastifyStatic, { root: options.webRoot, wildcard: false })
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = (request.url.split('?')[0] ?? '').startsWith('/api/')
    // Client-side routes (/khach/123...) are answered with the app shell, never with a 404 page.
    if (options.webRoot && request.method === 'GET' && !isApi) return reply.sendFile('index.html')
    return reply.status(404).send(toErrorBody('NOT_FOUND', 'Không tìm thấy'))
  })

  // Shape follows PLAN §7.3.
  app.get('/api/health', async (_request, reply) => {
    const dbOk = canQueryDatabase(db)
    // 503 lets installer/updater scripts use a plain `curl -f` as their health check.
    if (!dbOk) reply.status(503)

    let backups: { lastBackup: { at: string; status: 'ok' } | null; warnings: string[] } = {
      lastBackup: null,
      warnings: [],
    }
    if (dbOk) {
      try {
        const destinations = options.backupDestinations?.() ?? []
        backups = backupHealth(
          db,
          ctx.now(),
          destinations.some((destination) => destination.type === 's3'),
          destinations.filter((destination) => destination.type === 'folder'),
        )
      } catch (error) {
        // The health check itself must never fail because backup bookkeeping is unreadable.
        ctx.logger.error({ component: 'health', err: error }, 'cannot read backup status')
        backups.warnings.push('Không đọc được trạng thái sao lưu')
      }
    }
    return {
      status: !dbOk ? 'error' : backups.warnings.length > 0 ? 'warning' : 'ok',
      version,
      schemaVersion: dbOk ? getSchemaVersion(db) : null,
      db: { ok: dbOk },
      lastBackup: backups.lastBackup,
      warnings: backups.warnings,
    }
  })

  registerAuthRoutes(app, ctx, { secureCookie: hosted })
  registerSettingsRoutes(app, ctx)
  registerCustomerRoutes(app, ctx)
  registerCatalogRoutes(app, ctx)
  registerPriceBookRoutes(app, ctx)
  registerOrderRoutes(app, ctx)
  registerReturnRoutes(app, ctx)
  registerPaymentRoutes(app, ctx)
  registerAdjustmentRoutes(app, ctx)
  registerLedgerRoutes(app, ctx)
  registerReportRoutes(app, ctx)
  registerSystemRoutes(app, ctx)
  if (options.backup) registerBackupRoutes(app, { ...options.backup, maintenance })

  return app
}
