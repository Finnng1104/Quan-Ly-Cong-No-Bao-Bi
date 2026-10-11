import type { Logger } from 'pino'
import type { Database } from '../db/client.js'
import { createUser } from '../modules/auth/service.js'

export type InitAdminResult = 'created' | 'already-exists'

/**
 * Creates the first (owner) account. Running it again on an installed system is a no-op, which
 * keeps the installer idempotent: re-running it never resets an existing password.
 */
export async function initAdmin(
  db: Database,
  logger: Logger,
  input: { username: string; password: string },
): Promise<InitAdminResult> {
  const existing = db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }
  if (existing.total > 0) return 'already-exists'

  await createUser(
    { db, logger, now: () => new Date() },
    { username: input.username, password: input.password, role: 'owner' },
  )
  return 'created'
}
