import fsp from 'node:fs/promises'
import type { S3BackupDestination } from '../../config/index.js'
import { signRequest } from './sigv4.js'

const UPLOAD_TIMEOUT_MS = 5 * 60_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000
// Listing runs while a person waits on the Settings page, so a dead network must fail fast.
const LIST_TIMEOUT_MS = 10_000
const LIST_PAGE_SIZE = 1000

/** `qlcn-<UTC stamp>-<trigger>.db.gz`. The stamp sorts chronologically as plain text. */
export const BACKUP_FILE_NAME_PATTERN = /^qlcn-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-([a-z-]+)\.db\.gz$/

export interface CloudBackupObject {
  fileName: string
  sizeBytes: number
  lastModified: string
}

interface S3Call {
  destination: S3BackupDestination
  fetchImpl: typeof fetch
  now: Date
}

interface S3Request {
  method: 'GET' | 'PUT' | 'DELETE'
  /** Object file name inside the destination's prefix; omitted for bucket-level calls. */
  fileName?: string
  query?: Record<string, string>
  body?: Buffer
  contentType?: string
  timeoutMs: number
}

function objectKey(destination: S3BackupDestination, fileName: string): string {
  return `${destination.prefix}${fileName}`
}

async function s3Fetch(call: S3Call, request: S3Request): Promise<Response> {
  const { destination } = call
  const base = `${destination.endpoint.replace(/\/+$/, '')}/${destination.bucket}`
  const objectPath = request.fileName
    ? `/${objectKey(destination, request.fileName).split('/').map(encodeURIComponent).join('/')}`
    : ''
  const url = new URL(`${base}${objectPath}`)
  for (const [name, value] of Object.entries(request.query ?? {})) url.searchParams.set(name, value)

  const payload = request.body ?? Buffer.alloc(0)
  const headers = signRequest({
    method: request.method,
    url,
    headers: request.contentType ? { 'content-type': request.contentType } : {},
    payload,
    region: destination.region,
    accessKeyId: destination.accessKeyId,
    secretAccessKey: destination.secretAccessKey,
    now: call.now,
  })

  return call.fetchImpl(url, {
    method: request.method,
    headers,
    ...(request.body ? { body: new Uint8Array(request.body) } : {}),
    signal: AbortSignal.timeout(request.timeoutMs),
  })
}

async function assertOk(response: Response, action: string): Promise<void> {
  if (response.ok) return
  const text = (await response.text()).slice(0, 300)
  throw new Error(`${action}: HTTP ${response.status} ${response.statusText}: ${text}`)
}

export async function uploadCloudBackup(call: S3Call, fileName: string, body: Buffer): Promise<void> {
  const response = await s3Fetch(call, {
    method: 'PUT',
    fileName,
    body,
    contentType: 'application/gzip',
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
  await assertOk(response, 'upload')
}

export async function downloadCloudBackup(call: S3Call, fileName: string, targetPath: string): Promise<void> {
  const response = await s3Fetch(call, { method: 'GET', fileName, timeoutMs: DOWNLOAD_TIMEOUT_MS })
  await assertOk(response, 'download')
  await fsp.writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
}

export async function deleteCloudBackup(call: S3Call, fileName: string): Promise<void> {
  const response = await s3Fetch(call, { method: 'DELETE', fileName, timeoutMs: UPLOAD_TIMEOUT_MS })
  await assertOk(response, 'delete')
}

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const unescapeXml = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m)

function tagValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? unescapeXml(match[1] as string) : null
}

/**
 * Lists the backups stored at the destination, oldest first. Objects whose names do not look
 * like our snapshots are ignored, so a shared bucket never leaks other files into the app.
 */
export async function listCloudBackups(call: S3Call): Promise<CloudBackupObject[]> {
  const found: CloudBackupObject[] = []
  let continuationToken: string | null = null

  do {
    const query: Record<string, string> = {
      'list-type': '2',
      'max-keys': String(LIST_PAGE_SIZE),
      prefix: call.destination.prefix,
    }
    if (continuationToken) query['continuation-token'] = continuationToken

    const response = await s3Fetch(call, { method: 'GET', query, timeoutMs: LIST_TIMEOUT_MS })
    await assertOk(response, 'list')
    const xml = await response.text()

    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const key = tagValue(block, 'Key')
      if (!key?.startsWith(call.destination.prefix)) continue
      const fileName = key.slice(call.destination.prefix.length)
      if (!BACKUP_FILE_NAME_PATTERN.test(fileName)) continue
      found.push({
        fileName,
        sizeBytes: Number(tagValue(block, 'Size') ?? 0),
        lastModified: tagValue(block, 'LastModified') ?? '',
      })
    }

    continuationToken = tagValue(xml, 'IsTruncated') === 'true' ? tagValue(xml, 'NextContinuationToken') : null
  } while (continuationToken)

  return found.sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0))
}

/** Proves the credentials can list, write and delete, which is everything the app relies on. */
export async function probeCloudDestination(call: S3Call): Promise<void> {
  await listCloudBackups(call)
  const probeName = 'qlcn-connection-test.txt'
  const response = await s3Fetch(call, {
    method: 'PUT',
    fileName: probeName,
    body: Buffer.from('ok'),
    contentType: 'text/plain',
    timeoutMs: LIST_TIMEOUT_MS,
  })
  await assertOk(response, 'write test')
  await deleteCloudBackup(call, probeName)
}
