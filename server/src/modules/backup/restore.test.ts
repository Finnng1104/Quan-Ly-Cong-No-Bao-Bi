import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger, makeTempDir, removeDir } from '../../../test/helpers/index.js'
import { openDatabase } from '../../db/client.js'
import { loadMigrationFiles, runMigrations } from '../../db/migrate.js'
import { restoreFromBackup, RestoreError, type RestoreInput } from './restore.js'
import { runBackup } from './service.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe('restore', () => {
  let dir: string
  let dbPath: string
  let backupsDir: string
  const { logger } = createCaptureLogger()
  const clock = () => new Date('2026-10-11T03:00:00Z')

  const addCustomer = (name: string) => {
    const db = openDatabase(dbPath)
    db.prepare(
      `INSERT INTO customers (id, branch_id, name, search_text, opening_debt_date, created_at, updated_at)
       VALUES (?, 'main', ?, ?, '2026-10-01', 'x', 'x')`,
    ).run(`id-${name}`, name, name.toLowerCase())
    db.close()
  }
  const customerNames = (): string[] => {
    const db = openDatabase(dbPath)
    const rows = db.prepare('SELECT name FROM customers ORDER BY name').all() as { name: string }[]
    db.close()
    return rows.map((row) => row.name)
  }
  const takeBackup = async (now: () => Date = clock): Promise<string> => {
    const db = openDatabase(dbPath)
    const result = await runBackup(
      { db, backupsDir, config: { localRetention: 7, destinationRetention: 30, destinations: [] }, logger, now },
      'manual',
    )
    db.close()
    return result.localPath as string
  }
  const input = (source: string, overrides: Partial<RestoreInput> = {}): RestoreInput => ({
    dbPath,
    backupsDir,
    source,
    supportedSchemaVersion: 1,
    logger,
    now: clock,
    isServerRunning: async () => false,
    ...overrides,
  })

  beforeEach(() => {
    dir = makeTempDir()
    dbPath = path.join(dir, 'data', 'app.db')
    backupsDir = path.join(dir, 'backups')
    const db = openDatabase(dbPath)
    runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
    db.close()
  })

  afterEach(() => removeDir(dir))

  it('brings back the data of a backup and keeps a snapshot of what it replaced', async () => {
    addCustomer('Thanh Nhi')
    const backup = await takeBackup()
    addCustomer('Added after the backup')
    expect(customerNames()).toEqual(['Added after the backup', 'Thanh Nhi'])

    const result = await restoreFromBackup(input(backup))

    expect(customerNames()).toEqual(['Thanh Nhi'])
    // The state just before the restore is saved, so the restore itself can be undone.
    expect(result.safetySnapshot).toMatch(/pre-restore\.db\.gz$/)
    expect(fs.existsSync(result.safetySnapshot as string)).toBe(true)
    const undo = await restoreFromBackup(input(result.safetySnapshot as string))
    expect(undo.restoredFrom).toBe(result.safetySnapshot)
    expect(customerNames()).toEqual(['Added after the backup', 'Thanh Nhi'])
  })

  it('finds the newest backup of a given day by date', async () => {
    addCustomer('Thanh Nhi')
    await takeBackup() // 2026-10-11
    addCustomer('Later')

    const result = await restoreFromBackup(input('2026-10-11'))

    expect(result.restoredFrom).toContain('2026-10-11T03-00-00Z')
    expect(customerNames()).toEqual(['Thanh Nhi'])
  })

  it('matches the date in shop time, not in the UTC time of the file name', async () => {
    addCustomer('Thanh Nhi')
    // 20:00 UTC on 11/10 is 03:00 on 12/10 in Vietnam.
    await takeBackup(() => new Date('2026-10-11T20:00:00Z'))

    await expect(restoreFromBackup(input('2026-10-11'))).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
    const result = await restoreFromBackup(input('2026-10-12'))
    expect(result.restoredFrom).toContain('2026-10-11T20-00-00Z')
  })

  it('refuses while the server is running', async () => {
    addCustomer('Thanh Nhi')
    const backup = await takeBackup()

    await expect(restoreFromBackup(input(backup, { isServerRunning: async () => true }))).rejects.toMatchObject({
      code: 'SERVER_RUNNING',
    })
  })

  it('refuses a missing file, a non-database file and a corrupt database, leaving the data alone', async () => {
    addCustomer('Thanh Nhi')

    await expect(restoreFromBackup(input(path.join(dir, 'nope.db.gz')))).rejects.toMatchObject({
      code: 'SOURCE_NOT_FOUND',
    })
    await expect(restoreFromBackup(input('2026-01-01'))).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })

    const garbage = path.join(dir, 'garbage.db')
    fs.writeFileSync(garbage, 'this is not a database at all, just text '.repeat(50))
    await expect(restoreFromBackup(input(garbage))).rejects.toBeInstanceOf(RestoreError)

    expect(customerNames()).toEqual(['Thanh Nhi'])
    expect(fs.readdirSync(path.dirname(dbPath)).filter((name) => name.includes('.restore-'))).toEqual([])
  })

  it('refuses a backup written by a newer version of the app', async () => {
    addCustomer('Thanh Nhi')
    const backup = await takeBackup()

    await expect(restoreFromBackup(input(backup, { supportedSchemaVersion: 0 }))).rejects.toMatchObject({
      code: 'NEWER_THAN_CODE',
    })
    expect(customerNames()).toEqual(['Thanh Nhi'])
  })
})
