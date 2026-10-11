import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { parseInput } from '../../shared/validation.js'

const MAX_REPORTS_PER_MINUTE = 30

const clientLogSchema = z.object({
  level: z.enum(['error', 'warn', 'info']).default('error'),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  userAgent: z.string().max(300).optional(),
})

/**
 * Receives errors caught in the browser so they end up next to the server's own log, where
 * support will look. Bounded in size and rate so a broken page cannot flood the disk.
 */
export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  const webLog = ctx.logger.child({ component: 'web' })
  let windowStartedAt = 0
  let reportsInWindow = 0

  app.post('/api/client-log', async (request) => {
    if (!request.user) throw new AppError('UNAUTHENTICATED', 'Vui lòng đăng nhập')

    const nowMs = ctx.now().getTime()
    if (nowMs - windowStartedAt > 60_000) {
      windowStartedAt = nowMs
      reportsInWindow = 0
    }
    reportsInWindow += 1
    if (reportsInWindow > MAX_REPORTS_PER_MINUTE) {
      throw new AppError('RATE_LIMITED', 'Too many client reports')
    }

    const report = parseInput(clientLogSchema, request.body)
    const fields = { stack: report.stack, url: report.url, userAgent: report.userAgent }
    webLog[report.level](fields, report.message)
    return { ok: true }
  })
}
