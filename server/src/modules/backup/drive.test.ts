import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger, makeTempDir, removeDir, waitFor } from '../../../test/helpers/index.js'
import { openDatabase, type Database } from '../../db/client.js'
import { loadMigrationFiles, runMigrations } from '../../db/migrate.js'
import { backupHealth, runBackup, startBackupScheduler, syncDestinations, type BackupDependencies } from './service.js'
import { mountPointOf } from './stores.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe('external drive backups', () => {
  let dir: string
  let drivePath: string
  let db: Database
  let clock: Date
  const { logger } = createCaptureLogger()

  const deps = (overrides: Partial<BackupDependencies> = {}): BackupDependencies => ({
    db,
    backupsDir: path.join(dir, 'backups'),
    config: {
      localRetention: 7,
      destinationRetention: 30,
      destinations: [{ type: 'folder', path: drivePath, mode: 'always' }],
    },
    logger,
    now: () => clock,
    ...overrides,
  })
  const plugIn = () => fs.mkdirSync(path.join(dir, 'Volumes', 'Backup Drive'), { recursive: true })
  const unplug = () => fs.rmSync(path.join(dir, 'Volumes', 'Backup Drive'), { recursive: true, force: true })
  const onDrive = () => (fs.existsSync(drivePath) ? fs.readdirSync(drivePath).sort() : [])
  const snapshotAt = (iso: string) => {
    clock = new Date(iso)
    return runBackup(deps(), 'periodic')
  }

  beforeEach(() => {
    dir = makeTempDir()
    drivePath = path.join(dir, 'Volumes', 'Backup Drive', 'QuanLyCongNo-SaoLuu')
    clock = new Date('2026-10-11T03:00:00Z')
    db = openDatabase(path.join(dir, 'app.db'))
    runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
  })

  afterEach(() => {
    db.close()
    removeDir(dir)
  })

  it('finds the volume a folder lives on', () => {
    expect(mountPointOf('/Volumes/Backup Drive/QuanLyCongNo-SaoLuu')).toBe('/Volumes/Backup Drive')
    expect(mountPointOf('/home/shop/backups')).toBe('/home/shop')
  })

  it('copies a backup to the plugged-in drive', async () => {
    plugIn()

    const result = await snapshotAt('2026-10-11T03:00:00Z')

    expect(result.destinations[1]).toMatchObject({ kind: 'folder', ok: true })
    expect(onDrive()).toEqual([result.fileName])
  })

  it('never creates the drive folder on the internal disk while it is unplugged', async () => {
    const result = await snapshotAt('2026-10-11T03:00:00Z')

    expect(result.ok).toBe(true)
    expect(result.destinations[1]).toMatchObject({ ok: false, unavailable: true })
    expect(fs.existsSync(path.join(dir, 'Volumes'))).toBe(false)
    // Being unplugged is not a failure to record against the drive.
    expect(db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE destination LIKE 'folder:%'").get()).toEqual({ n: 0 })
  })

  it('catches up everything missed once the drive is plugged back in', async () => {
    const first = await snapshotAt('2026-10-11T03:00:00Z')
    const second = await snapshotAt('2026-10-11T09:00:00Z')
    expect(await syncDestinations(deps())).toMatchObject([{ ok: false, unavailable: true }])

    plugIn()
    const [outcome] = await syncDestinations(deps())

    expect(outcome).toMatchObject({ ok: true, copied: [first.fileName, second.fileName] })
    expect(onDrive()).toEqual([first.fileName, second.fileName].sort())
  })

  it('is copied by the scheduler without anyone asking once the drive appears', async () => {
    const first = await snapshotAt('2026-10-11T03:00:00Z')
    const start = new Date('2026-10-11T03:00:00Z')
    clock = start
    const scheduler = startBackupScheduler(deps(), { checkIntervalMs: 10, networkRetryMs: 60_000 })
    clock = new Date(start.getTime() + 60 * 60_000)

    try {
      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(onDrive()).toEqual([])
      plugIn()
      await waitFor(() => onDrive().includes(first.fileName as string), { description: 'drive catch-up' })
    } finally {
      scheduler.stop()
    }
  })

  it('keeps only the newest copies on the drive', async () => {
    plugIn()
    await snapshotAt('2026-10-11T03:00:00Z')
    await snapshotAt('2026-10-11T09:00:00Z')
    const newest = await snapshotAt('2026-10-11T15:00:00Z')
    fs.writeFileSync(path.join(drivePath, 'qlcn-2026-10-01T00-00-00Z-periodic.db.gz'), 'old')
    const config = { ...deps().config, destinationRetention: 3 }

    const [outcome] = await syncDestinations(deps({ config }))

    expect(outcome?.pruned).toEqual(['qlcn-2026-10-01T00-00-00Z-periodic.db.gz'])
    expect(onDrive()).toHaveLength(3)
    expect(onDrive()).toContain(newest.fileName)
  })

  it('ignores a half-copied file and replaces it', async () => {
    plugIn()
    const result = await snapshotAt('2026-10-11T03:00:00Z')
    fs.rmSync(path.join(drivePath, result.fileName as string))
    fs.writeFileSync(path.join(drivePath, `${result.fileName}.partial`), 'half')

    const [outcome] = await syncDestinations(deps())

    expect(outcome?.copied).toEqual([result.fileName])
    expect(fs.statSync(path.join(drivePath, result.fileName as string)).size).toBe(result.sizeBytes)
  })

  describe('health', () => {
    const installedAt = '2026-09-01T00:00:00Z'
    const now = new Date('2026-10-11T03:00:00Z')
    const drive = (mode: 'always' | 'occasional') => [{ type: 'folder' as const, path: '/x', mode }]
    beforeEach(() => {
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u','a','x','owner',?)",
      ).run(installedAt)
      db.prepare(
        `INSERT INTO backup_runs (id, started_at, finished_at, trigger, destination, status)
         VALUES ('r', ?, ?, 'periodic', 'local', 'ok')`,
      ).run(now.toISOString(), now.toISOString())
    })

    it('warns after 48 hours for a drive that stays plugged in', () => {
      expect(backupHealth(db, now, false, drive('always')).warnings).toEqual([
        'Đã hơn 48 giờ chưa sao lưu ra ổ cứng ngoài. Hãy kiểm tra ổ đã được cắm chưa.',
      ])
    })

    it('stays quiet for a drive used now and then until 14 days have passed', () => {
      db.prepare(
        `INSERT INTO backup_runs (id, started_at, finished_at, trigger, destination, status)
         VALUES ('d', ?, ?, 'periodic', 'folder:/x', 'ok')`,
      ).run('2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')

      expect(backupHealth(db, now, false, drive('occasional')).warnings).toEqual([])
      expect(backupHealth(db, new Date('2026-10-25T00:00:00Z'), false, drive('occasional')).warnings).toContain(
        'Đã hơn 14 ngày chưa sao lưu ra ổ cứng ngoài. Hãy cắm ổ vào máy.',
      )
    })
  })
})
