import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { LOG_LEVELS, type LogLevel } from '../shared/logger.js'

// Fixed for the lifetime of an install: the PWA and the session cookie are bound to this origin.
export const DEFAULT_PORT = 8686
export const SERVER_HOST = '127.0.0.1'
// Hosted online (e.g. a trial server for the customer), the platform's proxy must reach us.
const HOSTED_SERVER_HOST = '0.0.0.0'
const APP_DIR_NAME = 'QuanLyCongNo'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface FolderBackupDestination {
  type: 'folder'
  path: string
}

export interface S3BackupDestination {
  type: 's3'
  /** e.g. https://<account>.r2.cloudflarestorage.com for Cloudflare R2. */
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Optional folder inside the bucket, e.g. "qlcn/". */
  prefix: string
}

export type BackupDestination = FolderBackupDestination | S3BackupDestination

export interface BackupConfig {
  /** Regular local snapshots to keep. Snapshots taken before updates/restores are kept separately. */
  localRetention: number
  destinations: BackupDestination[]
}

export interface AppConfig {
  host: string
  port: number
  /**
   * https origins the app is reached through when hosted online (QLCN_PUBLIC_URLS), e.g. the
   * Vercel site and the backend's own address. Empty for a normal install on the shop's machine,
   * which only ever listens on localhost.
   */
  publicOrigins: string[]
  dataDir: string
  dbPath: string
  logsDir: string
  backupsDir: string
  configFilePath: string
  logLevel: LogLevel
  backup: BackupConfig
  /** Folder with the built web app to serve next to the API; null when it is served elsewhere (dev). */
  webRoot: string | null
}

export interface ConfigFlags {
  dataDir?: string | undefined
  port?: string | undefined
  logLevel?: string | undefined
  webRoot?: string | undefined
}

export interface LoadConfigInput {
  flags: ConfigFlags
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDir?: string
}

// Unknown keys are kept on purpose: later phases add backup/update settings to the same file.
const backupDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('folder'), path: z.string().min(1) }),
  z.object({
    type: z.literal('s3'),
    endpoint: z.url(),
    bucket: z.string().min(1),
    region: z.string().min(1).default('auto'),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    prefix: z.string().default(''),
  }),
])

const configFileSchema = z
  .object({
    port: z.number().int().optional(),
    logLevel: z.enum(LOG_LEVELS as [LogLevel, ...LogLevel[]]).optional(),
    webRoot: z.string().min(1).optional(),
    backup: z
      .object({
        localRetention: z.number().int().min(1).max(60).default(7),
        destinations: z.array(backupDestinationSchema).default([]),
      })
      .optional(),
  })
  .loose()

/** Where customer data lives. Kept apart from the app folder so reinstalling never touches it. */
export function defaultDataDir(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string {
  if (platform === 'win32') {
    return path.win32.join(env['ProgramData'] ?? 'C:\\ProgramData', APP_DIR_NAME)
  }
  if (platform === 'darwin') {
    return path.posix.join(homeDir, 'Library', 'Application Support', APP_DIR_NAME)
  }
  return path.posix.join(homeDir, '.local', 'share', APP_DIR_NAME)
}

function parsePort(raw: unknown, source: string): number {
  const port = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new ConfigError(`Invalid port from ${source}: "${String(raw)}" (expected 1024-65535)`)
  }
  return port
}

function parsePublicOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  return raw.split(',').map((entry) => {
    let url: URL
    try {
      url = new URL(entry.trim())
    } catch {
      throw new ConfigError(`Invalid address in QLCN_PUBLIC_URLS: "${entry.trim()}"`)
    }
    // The session cookie is marked Secure when hosted, so plain http would make login impossible.
    if (url.protocol !== 'https:') {
      throw new ConfigError(`QLCN_PUBLIC_URLS must use https: "${entry.trim()}"`)
    }
    return url.origin
  })
}

function parseLogLevel(raw: string, source: string): LogLevel {
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new ConfigError(`Invalid log level from ${source}: "${raw}" (expected ${LOG_LEVELS.join('|')})`)
  }
  return raw as LogLevel
}

function readConfigFile(configFilePath: string): z.infer<typeof configFileSchema> {
  let text: string
  try {
    text = fs.readFileSync(configFilePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new ConfigError(`Cannot read ${configFilePath}: ${(error as Error).message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new ConfigError(`${configFilePath} is not valid JSON`)
  }

  const parsed = configFileSchema.safeParse(json)
  if (!parsed.success) {
    throw new ConfigError(`${configFilePath} is invalid: ${parsed.error.message}`)
  }
  return parsed.data
}

/** Precedence: command-line flag > environment variable > config.json > default. */
export function loadConfig(input: LoadConfigInput): AppConfig {
  const { flags, env } = input
  const platform = input.platform ?? process.platform
  const homeDir = input.homeDir ?? os.homedir()

  const dataDir = path.resolve(
    flags.dataDir ?? env['QLCN_DATA_DIR'] ?? defaultDataDir(platform, env, homeDir),
  )
  const configFilePath = path.join(dataDir, 'config.json')
  const file = readConfigFile(configFilePath)

  const publicOrigins = parsePublicOrigins(env['QLCN_PUBLIC_URLS'])
  const hosted = publicOrigins.length > 0

  const port =
    flags.port !== undefined
      ? parsePort(flags.port, '--port')
      : env['QLCN_PORT'] !== undefined
        ? parsePort(env['QLCN_PORT'], 'QLCN_PORT')
        : // Hosting platforms (Railway, Render, Fly...) tell the app which port to use through PORT.
          hosted && env['PORT'] !== undefined
          ? parsePort(env['PORT'], 'PORT')
          : file.port !== undefined
            ? parsePort(file.port, 'config.json')
            : DEFAULT_PORT

  const logLevel =
    flags.logLevel !== undefined
      ? parseLogLevel(flags.logLevel, '--log-level')
      : env['QLCN_LOG_LEVEL'] !== undefined
        ? parseLogLevel(env['QLCN_LOG_LEVEL'], 'QLCN_LOG_LEVEL')
        : (file.logLevel ?? 'info')

  const webRoot = flags.webRoot ?? env['QLCN_WEB_ROOT'] ?? file.webRoot

  return {
    host: hosted ? HOSTED_SERVER_HOST : SERVER_HOST,
    port,
    publicOrigins,
    dataDir,
    dbPath: path.join(dataDir, 'data', 'app.db'),
    logsDir: path.join(dataDir, 'logs'),
    backupsDir: path.join(dataDir, 'backups'),
    configFilePath,
    logLevel,
    backup: file.backup ?? { localRetention: 7, destinations: [] },
    webRoot: webRoot ? path.resolve(webRoot) : null,
  }
}
