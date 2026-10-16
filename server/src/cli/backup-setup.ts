import fs from 'node:fs'
import path from 'node:path'
import type { BackupDestination, S3BackupDestination } from '../config/index.js'

export class BackupSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupSetupError'
  }
}

export interface CloudSettingsInput {
  /** Cloudflare account id (32 hex characters) or a full https endpoint of another S3 service. */
  accountOrEndpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  prefix?: string
}

const CLOUDFLARE_ACCOUNT_ID = /^[0-9a-f]{32}$/i
// Bucket names: lowercase letters, digits and dashes, 3-63 characters (R2 and S3 agree on this).
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

/** Turns what a person copied from the Cloudflare dashboard into a destination, rejecting typos early. */
export function buildS3Destination(input: CloudSettingsInput): S3BackupDestination {
  const account = input.accountOrEndpoint.trim()
  let endpoint: string
  if (CLOUDFLARE_ACCOUNT_ID.test(account)) {
    endpoint = `https://${account.toLowerCase()}.r2.cloudflarestorage.com`
  } else {
    let url: URL
    try {
      url = new URL(account)
    } catch {
      throw new BackupSetupError('Account ID phải gồm 32 ký tự (chữ số và a-f), hoặc là địa chỉ https đầy đủ')
    }
    if (url.protocol !== 'https:') throw new BackupSetupError('Địa chỉ phải bắt đầu bằng https://')
    endpoint = url.origin
  }

  const bucket = input.bucket.trim()
  if (!BUCKET_NAME.test(bucket)) {
    throw new BackupSetupError('Tên bucket chỉ gồm chữ thường, số và dấu gạch ngang (3-63 ký tự)')
  }
  const accessKeyId = input.accessKeyId.trim()
  const secretAccessKey = input.secretAccessKey.trim()
  if (!accessKeyId || !secretAccessKey) throw new BackupSetupError('Thiếu Access Key hoặc Secret Key')

  const rawPrefix = (input.prefix ?? '').trim().replace(/^\/+/, '')
  const prefix = rawPrefix === '' || rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`

  return { type: 's3', endpoint, bucket, region: 'auto', accessKeyId, secretAccessKey, prefix }
}

function readConfigObject(configFilePath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(configFilePath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new BackupSetupError(`Không đọc được ${configFilePath}: ${(error as Error).message}`)
  }
}

function writeConfigObject(configFilePath: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true })
  const temporaryPath = `${configFilePath}.tmp`
  // The file can hold a secret key, so only its owner may read it.
  fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, configFilePath)
}

function withDestinations(
  current: Record<string, unknown>,
  change: (destinations: { type?: string }[]) => { type?: string }[],
): Record<string, unknown> {
  const backup = (current['backup'] ?? {}) as { destinations?: { type?: string }[] }
  return { ...current, backup: { ...backup, destinations: change(backup.destinations ?? []) } }
}

/**
 * Writes the destination into config.json, replacing any earlier destination of the same kind
 * (one external drive, one online bucket) and keeping every other setting.
 */
export function saveDestination(configFilePath: string, destination: BackupDestination): void {
  const next = withDestinations(readConfigObject(configFilePath), (destinations) => [
    ...destinations.filter((entry) => entry.type !== destination.type),
    destination,
  ])
  writeConfigObject(configFilePath, next)
}

export function removeDestination(configFilePath: string, type: BackupDestination['type']): void {
  const next = withDestinations(readConfigObject(configFilePath), (destinations) =>
    destinations.filter((entry) => entry.type !== type),
  )
  writeConfigObject(configFilePath, next)
}
