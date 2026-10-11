import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

// Node's default scrypt memory limit (32 MiB) is exactly what N=2^15, r=8 needs (128 * N * r),
// so it fails with "memory limit exceeded" on the edge. Set the limit explicitly with headroom.
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const DEFAULT_COST = { N: 2 ** 15, r: 8, p: 1 }

export const MIN_PASSWORD_LENGTH = 4

interface ScryptCost {
  N: number
  r: number
  p: number
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...cost, maxmem: SCRYPT_MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    )
  })
}

/** Returns `scrypt$N$r$p$<salt>$<hash>`; the parameters live in the string so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await derive(password, salt, DEFAULT_COST)
  const { N, r, p } = DEFAULT_COST
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string]
  const cost = { N: Number(n), r: Number(r), p: Number(p) }
  if (![cost.N, cost.r, cost.p].every((value) => Number.isInteger(value) && value > 0)) return false

  const expected = Buffer.from(hashB64, 'base64')
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), cost)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
