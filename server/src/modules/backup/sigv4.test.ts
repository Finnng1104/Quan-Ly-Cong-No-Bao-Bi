import { describe, expect, it } from 'vitest'
import { signRequest } from './sigv4.js'

// Examples from Amazon's own documentation for Signature Version 4 on S3
// ("Examples: Signature calculations (AWS Signature Version 4)"). Matching them proves the signer
// is correct without needing a real bucket.
const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  now: new Date('2013-05-24T00:00:00Z'),
}

const signatureOf = (headers: Record<string, string>): string =>
  /Signature=([0-9a-f]{64})$/.exec(headers['authorization'] ?? '')?.[1] ?? ''

describe('AWS Signature Version 4', () => {
  it('signs GET Object with a Range header', () => {
    const headers = signRequest({
      ...CREDENTIALS,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { range: 'bytes=0-9' },
      payload: '',
    })

    expect(signatureOf(headers)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(headers['authorization']).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date')
  })

  it('signs PUT Object, including a path with a special character and extra headers', () => {
    const headers = signRequest({
      ...CREDENTIALS,
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test$file.text'),
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payload: 'Welcome to Amazon S3.',
    })

    expect(headers['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    )
    expect(signatureOf(headers)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
  })

  it('signs a request with query parameters', () => {
    const headers = signRequest({
      ...CREDENTIALS,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
      payload: '',
    })

    expect(signatureOf(headers)).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7')
  })
})
