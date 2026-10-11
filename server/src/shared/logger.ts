import path from 'node:path'
import pino, { type DestinationStream, type Logger } from 'pino'
import roll from 'pino-roll'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']

const LOG_FILES_TO_KEEP = 14

export interface CreateLoggerOptions {
  level: LogLevel
  /** Directory for rolling `app.<date>.<n>.log` files. Omit to log to stdout only (tests, CLI helpers). */
  logsDir?: string
  toStdout?: boolean
}

// Never let credentials reach disk, even if a future handler logs a whole request or body.
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'password',
  '*.password',
  'oldPassword',
  '*.oldPassword',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
]

export async function createLogger(options: CreateLoggerOptions): Promise<Logger> {
  const streams: { level: LogLevel; stream: DestinationStream }[] = []

  if (options.toStdout ?? true) {
    streams.push({ level: 'trace', stream: process.stdout })
  }

  if (options.logsDir) {
    const fileStream = await roll({
      file: path.join(options.logsDir, 'app'),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true,
      // Synchronous so a fatal log line written right before process.exit() is not lost.
      sync: true,
      limit: { count: LOG_FILES_TO_KEEP, removeOtherLogFiles: true },
    })
    streams.push({ level: 'trace', stream: fileStream })
  }

  return pino(
    {
      level: options.level,
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
    pino.multistream(streams),
  )
}
