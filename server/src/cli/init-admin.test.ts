import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger } from '../../test/helpers/index.js'
import { fileURLToPath } from 'node:url'
import { openDatabase, type Database } from '../db/client.js'
import { loadMigrationFiles, runMigrations } from '../db/migrate.js'
import { initAdmin } from './init-admin.js'

describe('initAdmin', () => {
  let db: Database
  const { logger } = createCaptureLogger()

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(
      db,
      loadMigrationFiles(fileURLToPath(new URL('../db/migrations', import.meta.url))),
    )
  })

  afterEach(() => db.close())

  it('creates the owner account with a hashed password', async () => {
    const result = await initAdmin(db, logger, { username: 'chucuahang', password: 'abcd1234' })

    expect(result).toBe('created')
    const user = db.prepare('SELECT username, role, password_hash FROM users').get() as {
      username: string
      role: string
      password_hash: string
    }
    expect(user).toMatchObject({ username: 'chucuahang', role: 'owner' })
    expect(user.password_hash).toMatch(/^scrypt\$/)
    expect(user.password_hash).not.toContain('abcd1234')
  })

  it('does nothing when an account already exists, so re-running the installer is safe', async () => {
    await initAdmin(db, logger, { username: 'chucuahang', password: 'abcd1234' })

    const result = await initAdmin(db, logger, { username: 'someone', password: 'different' })

    expect(result).toBe('already-exists')
    expect(db.prepare('SELECT COUNT(*) AS total FROM users').get()).toEqual({ total: 1 })
  })

  it('refuses a too short password', async () => {
    await expect(initAdmin(db, logger, { username: 'chucuahang', password: 'abc' })).rejects.toThrow(
      /tối thiểu/,
    )
  })
})
