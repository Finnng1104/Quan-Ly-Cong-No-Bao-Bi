/** An in-memory stand-in for an S3/R2 bucket, speaking just the calls the backup module makes. */
export interface FakeS3 {
  fetchImpl: typeof fetch
  /** Object key (including prefix) -> body. */
  objects: Map<string, Buffer>
  /** While true every request fails like a lost connection. */
  setOffline(offline: boolean): void
  requests: { method: string; key: string }[]
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export function createFakeS3(): FakeS3 {
  const objects = new Map<string, Buffer>()
  const requests: { method: string; key: string }[] = []
  let offline = false

  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    if (offline) throw new TypeError('fetch failed')
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    // Path-style addressing: /<bucket>/<key>
    const key = decodeURIComponent(url.pathname.split('/').filter(Boolean).slice(1).join('/'))
    requests.push({ method, key })

    if (method === 'PUT') {
      objects.set(key, Buffer.from(init.body as Uint8Array))
      return new Response('', { status: 200 })
    }
    if (method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (key === '') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const pageSize = Number(url.searchParams.get('max-keys') ?? 1000)
      const offset = Number(url.searchParams.get('continuation-token') ?? 0)
      const keys = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort()
      const page = keys.slice(offset, offset + pageSize)
      const truncated = offset + pageSize < keys.length
      const contents = page
        .map(
          (name) =>
            `<Contents><Key>${escapeXml(name)}</Key><LastModified>2026-10-11T03:00:00.000Z</LastModified>` +
            `<Size>${objects.get(name)?.length ?? 0}</Size></Contents>`,
        )
        .join('')
      return new Response(
        `<?xml version="1.0"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${offset + pageSize}</NextContinuationToken>` : '') +
          `${contents}</ListBucketResult>`,
        { status: 200 },
      )
    }
    const body = objects.get(key)
    if (!body) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404, statusText: 'Not Found' })
    return new Response(new Uint8Array(body), { status: 200 })
  }) as unknown as typeof fetch

  return {
    fetchImpl,
    objects,
    requests,
    setOffline: (value) => {
      offline = value
    },
  }
}
