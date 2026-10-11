// Minimal AWS Signature Version 4 signer, enough to PUT an object to any S3-compatible service
// (Cloudflare R2, Backblaze B2, AWS S3). Written with node:crypto so the server needs no SDK.

import { createHash, createHmac } from 'node:crypto'

export interface SignInput {
  method: string
  url: URL
  /** Extra headers to sign (lowercase names). `host`, `x-amz-date` and the payload hash are added. */
  headers?: Record<string, string>
  payload: Buffer | string
  region: string
  service?: string
  accessKeyId: string
  secretAccessKey: string
  now: Date
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data).digest()

// RFC 3986 encoding, which is stricter than encodeURIComponent (it leaves !'()* alone).
const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

function canonicalPath(pathname: string): string {
  // S3 signs the path once-encoded and does not normalise it.
  return pathname
    .split('/')
    .map((segment) => encode(decodeURIComponent(segment)))
    .join('/')
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/** Returns the headers to send, including `authorization`. */
export function signRequest(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3'
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(input.payload)

  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort()
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  const canonicalHeaders = names.map((name) => `${name}:${lowered[name]}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), service),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}
