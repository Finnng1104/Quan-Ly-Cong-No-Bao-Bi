import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { Logger } from 'pino'
import { buildApp } from './app.js'
import { ask, readLineFromStdin } from './cli/prompt.js'
import { initAdmin } from './cli/init-admin.js'
import { ConfigError, loadConfig, type AppConfig, type ConfigFlags } from './config/index.js'
import {
  NativeModuleLoadError,
  openDatabase,
  quickCheck,
  type Database,
} from './db/client.js'
import { loadMigrationFiles, MigrationError, runMigrations } from './db/migrate.js'
import { restoreFromBackup, RestoreError } from './modules/backup/restore.js'
import { runBackup, startBackupScheduler } from './modules/backup/service.js'
import { buildDiagnostics, writeDiagnosticsFile } from './modules/system/diagnostics.js'
import { MIN_PASSWORD_LENGTH } from './shared/password.js'
import { startSupervisor } from './supervisor.js'
import { EXIT_CODE } from './shared/exit-codes.js'
import { createLogger } from './shared/logger.js'
import { APP_VERSION } from './version.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('./db/migrations', import.meta.url))
const SHUTDOWN_TIMEOUT_MS = 10_000

const USAGE = `Usage: main <command> [options]

Commands:
  serve                 Run the HTTP server (migrates the database first)
  supervise             Run \`serve\` as a child process and restart it if it crashes
  migrate               Apply pending database migrations and exit
  init-admin            Create the first account (--username, --password-stdin)
  backup                Take a backup now and copy it to the configured destinations
                        (--trigger pre-update is used by the updater to label its safety copy)
  restore <file|date>   Replace the database with a backup (the server must be stopped)
  doctor                Write a diagnostics file to send to support (contains no shop data)
  version               Print the version and exit

Options:
  --data-dir <path>     Where data, logs and backups live
  --port <number>       HTTP port (default 8686)
  --log-level <level>   trace|debug|info|warn|error|fatal
  --web-root <path>     Folder with the built web app to serve
`

interface CommandLine {
  command: string | undefined
  positionals: string[]
  flags: ConfigFlags
  username: string | undefined
  passwordFromStdin: boolean
  trigger: string | undefined
}

function parseCommandLine(): CommandLine {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string' },
      port: { type: 'string' },
      'log-level': { type: 'string' },
      'web-root': { type: 'string' },
      username: { type: 'string' },
      'password-stdin': { type: 'boolean' },
      trigger: { type: 'string' },
    },
  })
  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags: {
      dataDir: values['data-dir'],
      port: values.port,
      logLevel: values['log-level'],
      webRoot: values['web-root'],
    },
    username: values.username,
    passwordFromStdin: values['password-stdin'] === true,
    trigger: values.trigger,
  }
}

class DatabaseCorruptError extends Error {
  constructor(readonly messages: string[]) {
    super(`Database failed its integrity check: ${messages.slice(0, 3).join('; ')}`)
    this.name = 'DatabaseCorruptError'
  }
}

/** Opens the database, refuses to continue on corruption, and brings the schema up to date. */
function prepareDatabase(config: AppConfig): Database {
  const db = openDatabase(config.dbPath)
  const check = quickCheck(db)
  if (!check.ok) {
    db.close()
    throw new DatabaseCorruptError(check.messages)
  }
  runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
  return db
}

/** Maps a startup failure to a stable exit code the supervisor and installer can act on. */
function exitCodeFor(error: unknown): number {
  if (error instanceof ConfigError) return EXIT_CODE.CONFIG_INVALID
  if (error instanceof NativeModuleLoadError) return EXIT_CODE.NATIVE_MODULE_LOAD_FAILED
  if (error instanceof DatabaseCorruptError) return EXIT_CODE.DB_CORRUPT
  if (error instanceof MigrationError) {
    return error.code === 'DB_NEWER_THAN_CODE' ? EXIT_CODE.DB_NEWER_THAN_CODE : EXIT_CODE.MIGRATION_FAILED
  }
  return EXIT_CODE.GENERIC_ERROR
}

async function loggerFor(config: AppConfig, component: string) {
  const root = await createLogger({ level: config.logLevel, logsDir: config.logsDir })
  return root.child({ component })
}

/**
 * Hosted online there is no terminal to run `init-admin` in, so the first account can come from
 * QLCN_ADMIN_USERNAME / QLCN_ADMIN_PASSWORD. Does nothing once any account exists.
 */
async function initAdminFromEnvironment(db: Database, logger: Logger): Promise<void> {
  const username = process.env['QLCN_ADMIN_USERNAME']
  const password = process.env['QLCN_ADMIN_PASSWORD']
  if (!username || !password) return
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ConfigError(`QLCN_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const result = await initAdmin(db, logger, { username, password })
  if (result === 'created') logger.info({ username }, 'first account created from the environment')
}

async function runServe(flags: ConfigFlags): Promise<void> {
  const config = loadConfig({ flags, env: process.env })
  // Untagged root logger: the app and its modules add their own component to each line.
  const rootLogger = await createLogger({ level: config.logLevel, logsDir: config.logsDir })
  const logger = rootLogger.child({ component: 'server' })

  let db: Database
  try {
    db = prepareDatabase(config)
    await initAdminFromEnvironment(db, logger)
  } catch (error) {
    logger.fatal({ err: error }, 'cannot prepare the database')
    process.exit(exitCodeFor(error))
  }

  const scheduler = startBackupScheduler({
    db,
    backupsDir: config.backupsDir,
    config: config.backup,
    logger: rootLogger,
    now: () => new Date(),
  })

  const app = await buildApp({
    port: config.port,
    db,
    logger: rootLogger,
    version: APP_VERSION,
    hasCloudBackup: config.backup.destinations.some((destination) => destination.type === 's3'),
    onDataChanged: () => scheduler.markDirty(),
    ...(config.webRoot ? { webRoot: config.webRoot } : {}),
    publicOrigins: config.publicOrigins,
  })

  let shuttingDown = false
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ reason }, 'shutting down')
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, exiting')
      process.exit(EXIT_CODE.GENERIC_ERROR)
    }, SHUTDOWN_TIMEOUT_MS)
    forceExit.unref()
    try {
      scheduler.stop()
      await app.close()
      db.close()
    } catch (error) {
      logger.error({ err: error }, 'error while shutting down')
      process.exit(EXIT_CODE.GENERIC_ERROR)
    }
    process.exit(EXIT_CODE.OK)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // Sent by the supervisor over IPC; signals cannot be delivered gracefully on Windows.
  process.on('message', (message) => {
    if ((message as { type?: string } | null)?.type === 'shutdown') void shutdown('supervisor request')
  })

  await app.listen({ host: config.host, port: config.port })
  logger.info(
    { version: APP_VERSION, port: config.port, dataDir: config.dataDir, node: process.version },
    'server started',
  )
}

async function runMigrate(flags: ConfigFlags): Promise<void> {
  const config = loadConfig({ flags, env: process.env })
  const logger = await loggerFor(config, 'migrate')
  try {
    const db = openDatabase(config.dbPath)
    const result = runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
    db.close()
    logger.info(result, 'migrations finished')
  } catch (error) {
    logger.fatal({ err: error }, 'migration failed')
    process.exit(exitCodeFor(error))
  }
}

async function runInitAdmin(cli: CommandLine): Promise<void> {
  const config = loadConfig({ flags: cli.flags, env: process.env })
  const logger = await loggerFor(config, 'init-admin')

  // The password never travels as a command-line argument, where other users could read it.
  const username = cli.username ?? (await ask('Tên đăng nhập: '))
  let password: string
  if (cli.passwordFromStdin) {
    password = await readLineFromStdin()
  } else if (process.stdin.isTTY) {
    password = await ask('Mật khẩu: ', true)
    const again = await ask('Nhập lại mật khẩu: ', true)
    if (password !== again) {
      console.error('Hai mật khẩu không khớp')
      process.exit(EXIT_CODE.GENERIC_ERROR)
    }
  } else {
    console.error('Provide the password with --password-stdin')
    process.exit(EXIT_CODE.GENERIC_ERROR)
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`)
    process.exit(EXIT_CODE.GENERIC_ERROR)
  }

  const db = prepareDatabase(config)
  try {
    const result = await initAdmin(db, logger, { username, password })
    console.log(result === 'created' ? `Đã tạo tài khoản "${username}"` : 'Tài khoản đã tồn tại, không thay đổi')
  } finally {
    db.close()
  }
}

async function runBackupCommand(cli: CommandLine): Promise<void> {
  const { flags } = cli
  const trigger = cli.trigger === 'pre-update' ? 'pre-update' : 'manual'
  const config = loadConfig({ flags, env: process.env })
  // The backup module tags its own log lines, so it gets the untagged logger.
  const logger = await createLogger({ level: config.logLevel, logsDir: config.logsDir })
  const db = prepareDatabase(config)
  try {
    const result = await runBackup(
      { db, backupsDir: config.backupsDir, config: config.backup, logger, now: () => new Date() },
      trigger,
    )
    console.log(JSON.stringify(result, null, 2))
    // Machine-readable line for the installer, which needs the file to roll back to.
    if (result.localPath) console.log(`BACKUP_FILE=${result.localPath}`)
    const everythingOk = result.ok && result.destinations.every((destination) => destination.ok)
    process.exitCode = everythingOk ? EXIT_CODE.OK : EXIT_CODE.GENERIC_ERROR
  } finally {
    db.close()
  }
}

async function isServerRunning(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) })
    return true
  } catch {
    return false
  }
}

async function runRestore(cli: CommandLine): Promise<void> {
  const source = cli.positionals[0]
  if (!source) {
    console.error('Usage: main restore <backup-file | YYYY-MM-DD>')
    process.exit(EXIT_CODE.GENERIC_ERROR)
  }
  const config = loadConfig({ flags: cli.flags, env: process.env })
  const logger = await createLogger({ level: config.logLevel, logsDir: config.logsDir })

  try {
    const result = await restoreFromBackup({
      dbPath: config.dbPath,
      backupsDir: config.backupsDir,
      source,
      supportedSchemaVersion: loadMigrationFiles(MIGRATIONS_DIR).length,
      logger,
      now: () => new Date(),
      isServerRunning: () => isServerRunning(config.port),
    })
    console.log(`Đã khôi phục từ: ${result.restoredFrom}`)
    if (result.safetySnapshot) console.log(`Bản dữ liệu trước khi khôi phục: ${result.safetySnapshot}`)
  } catch (error) {
    if (error instanceof RestoreError) {
      logger.child({ component: 'restore' }).error({ code: error.code }, error.message)
      console.error(error.message)
      process.exit(EXIT_CODE.GENERIC_ERROR)
    }
    throw error
  }
}

async function runDoctor(flags: ConfigFlags): Promise<void> {
  const config = loadConfig({ flags, env: process.env })
  const now = new Date()
  const report = await buildDiagnostics({ config, version: APP_VERSION, now })
  const file = await writeDiagnosticsFile(report, `${config.dataDir}/diagnostics`, now)
  console.log(`Đã tạo file chẩn đoán: ${file}`)
  console.log('File này không chứa dữ liệu khách hàng hay công nợ. Gửi file cho bộ phận hỗ trợ.')
}

async function runSupervise(flags: ConfigFlags): Promise<void> {
  const config = loadConfig({ flags, env: process.env })
  const logger = await loggerFor(config, 'supervisor')

  // Re-run this same entry point as `serve`, keeping the loader flags tsx needs in development.
  const passthrough: string[] = []
  if (flags.dataDir) passthrough.push('--data-dir', flags.dataDir)
  if (flags.port) passthrough.push('--port', flags.port)
  if (flags.logLevel) passthrough.push('--log-level', flags.logLevel)
  if (flags.webRoot) passthrough.push('--web-root', flags.webRoot)

  const supervisor = startSupervisor({
    command: process.execPath,
    args: [...process.execArgv, process.argv[1] as string, 'serve', ...passthrough],
    logger,
  })

  const stop = (reason: string): void => {
    logger.info({ reason }, 'supervisor stopping')
    void supervisor.stop()
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGBREAK', () => stop('SIGBREAK'))

  logger.info({ version: APP_VERSION }, 'supervisor started')
  const result = await supervisor.done
  logger.info(result, 'supervisor finished')

  if (result.reason === 'gave-up') process.exit(EXIT_CODE.SUPERVISOR_GAVE_UP)
  if (result.reason === 'fatal-exit') process.exit(result.lastExitCode ?? EXIT_CODE.GENERIC_ERROR)
  process.exit(EXIT_CODE.OK)
}

async function main(): Promise<void> {
  const cli = parseCommandLine()

  switch (cli.command) {
    case 'serve':
      return runServe(cli.flags)
    case 'supervise':
      return runSupervise(cli.flags)
    case 'migrate':
      return runMigrate(cli.flags)
    case 'init-admin':
      return runInitAdmin(cli)
    case 'backup':
      return runBackupCommand(cli)
    case 'restore':
      return runRestore(cli)
    case 'doctor':
      return runDoctor(cli.flags)
    case 'version':
      console.log(APP_VERSION)
      return
    default:
      console.error(USAGE)
      process.exit(cli.command === undefined ? EXIT_CODE.OK : EXIT_CODE.GENERIC_ERROR)
  }
}

main().catch((error: unknown) => {
  // The logger may not exist yet (bad config), so this is the one place we write to stderr.
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error)
  process.exit(exitCodeFor(error))
})
