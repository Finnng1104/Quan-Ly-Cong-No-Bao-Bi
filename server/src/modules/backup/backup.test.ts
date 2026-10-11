import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger, makeTempDir, removeDir } from '../../../test/helpers/index.js'
import { openDatabase, type Database } from '../../db/client.js'
import { loadMigrationFiles, runMigrations } from '../../db/migrate.js'
import { fileURLToPath } from 'node:url'
import {
  backupHealth,
  BACKUP_MAX_AGE_MS,
  BACKUP_STARTUP_DELAY_MS,
  decideBackup,
  lastSuccessfulLocalBackup,
  listLocalSnapshots,
  pruneLocalSnapshots,
  runBackup,
  type BackupDependencies,
} from './service.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe('backup', () => {
  let dir: string
  let db: Database
  let clock: Date
  const { logger } = createCaptureLogger()

  const deps = (overrides: Partial<BackupDependencies> = {}): BackupDependencies => ({
    db,
    backupsDir: path.join(dir, 'backups'),
    config: { localRetention: 7, destinations: [] },
    logger,
    now: () => clock,
    ...overrides,
  })

  beforeEach(() => {
    dir = makeTempDir()
    clock = new Date('2026-10-11T03:00:00Z')
    db = openDatabase(path.join(dir, 'app.db'))
    runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
    db.prepare(
      `INSERT INTO customers (id, branch_id, name, search_text, opening_debt_date, created_at, updated_at)
       VALUES ('c1', 'main', 'Thanh Nhi', 'thanh nhi', '2026-10-01', 'x', 'x')`,
    ).run()
  })

  afterEach(() => {
    db.close()
    removeDir(dir)
  })

  describe('snapshot', () => {
    it('writes a gzipped, self-contained copy of the live database', async () => {
      const result = await runBackup(deps(), 'manual')

      expect(result.ok).toBe(true)
      expect(result.fileName).toBe('qlcn-2026-10-11T03-00-00Z-manual.db.gz')
      expect(result.sizeBytes).toBeGreaterThan(0)

      // The copy opens as a normal database holding the same data.
      const restoredPath = path.join(dir, 'restored.db')
      fs.writeFileSync(restoredPath, gunzipSync(fs.readFileSync(result.localPath as string)))
      const copy = openDatabase(restoredPath)
      expect(copy.prepare("SELECT name FROM customers WHERE id = 'c1'").get()).toEqual({ name: 'Thanh Nhi' })
      expect(copy.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
      copy.close()
    })

    it('records every attempt in backup_runs', async () => {
      await runBackup(deps(), 'startup')

      const rows = db.prepare('SELECT trigger, destination, status FROM backup_runs').all()
      expect(rows).toEqual([{ trigger: 'startup', destination: 'local', status: 'ok' }])
      expect(lastSuccessfulLocalBackup(db)?.toISOString()).toBe('2026-10-11T03:00:00.000Z')
    })
  })

  describe('destinations', () => {
    it('copies to a folder destination, such as a USB drive', async () => {
      const usb = path.join(dir, 'usb')

      const result = await runBackup(
        deps({ config: { localRetention: 7, destinations: [{ type: 'folder', path: usb }] } }),
        'manual',
      )

      expect(result.destinations.every((d) => d.ok)).toBe(true)
      expect(fs.readdirSync(usb)).toEqual(['qlcn-2026-10-11T03-00-00Z-manual.db.gz'])
    })

    it('uploads to S3-compatible storage with a signed PUT', async () => {
      const calls: { url: string; headers: Record<string, string>; bodyLength: number }[] = []
      const fetchImpl = (async (url: URL, init: RequestInit) => {
        calls.push({
          url: String(url),
          headers: init.headers as Record<string, string>,
          bodyLength: (init.body as Uint8Array).length,
        })
        return new Response('', { status: 200 })
      }) as unknown as typeof fetch

      const result = await runBackup(
        deps({
          fetchImpl,
          config: {
            localRetention: 7,
            destinations: [
              {
                type: 's3',
                endpoint: 'https://acct.r2.cloudflarestorage.com',
                bucket: 'shop-khoilam',
                region: 'auto',
                accessKeyId: 'AKIA-TEST',
                secretAccessKey: 'secret-key',
                prefix: 'qlcn/',
              },
            ],
          },
        }),
        'periodic',
      )

      expect(result.destinations).toEqual([
        { destination: 'local', ok: true },
        { destination: 's3:shop-khoilam', ok: true },
      ])
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(
        'https://acct.r2.cloudflarestorage.com/shop-khoilam/qlcn/qlcn-2026-10-11T03-00-00Z-periodic.db.gz',
      )
      expect(calls[0]?.headers['authorization']).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIA-TEST\/20261011\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
      )
      expect(calls[0]?.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)
      expect(calls[0]?.bodyLength).toBe(result.sizeBytes)
      // The secret itself must never be sent.
      expect(JSON.stringify(calls[0]?.headers)).not.toContain('secret-key')
    })

    it('keeps the local backup, and records the failure, when a destination is down', async () => {
      const fetchImpl = (async () =>
        new Response('AccessDenied', { status: 403, statusText: 'Forbidden' })) as unknown as typeof fetch

      const result = await runBackup(
        deps({
          fetchImpl,
          config: {
            localRetention: 7,
            destinations: [
              {
                type: 's3',
                endpoint: 'https://acct.r2.cloudflarestorage.com',
                bucket: 'shop',
                region: 'auto',
                accessKeyId: 'a',
                secretAccessKey: 'b',
                prefix: '',
              },
            ],
          },
        }),
        'manual',
      )

      expect(result.ok).toBe(true)
      expect(result.destinations[1]).toMatchObject({ destination: 's3:shop', ok: false })
      expect(result.destinations[1]?.error).toContain('403')
      expect(fs.existsSync(result.localPath as string)).toBe(true)
      const failed = db.prepare("SELECT status, error FROM backup_runs WHERE destination = 's3:shop'").get() as {
        status: string
        error: string
      }
      expect(failed.status).toBe('failed')
      expect(failed.error).toContain('AccessDenied')
    })

    it('survives a network error', async () => {
      const fetchImpl = (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch

      const result = await runBackup(
        deps({
          fetchImpl,
          config: {
            localRetention: 7,
            destinations: [
              {
                type: 's3',
                endpoint: 'https://acct.r2.cloudflarestorage.com',
                bucket: 'shop',
                region: 'auto',
                accessKeyId: 'a',
                secretAccessKey: 'b',
                prefix: '',
              },
            ],
          },
        }),
        'manual',
      )

      expect(result.ok).toBe(true)
      expect(result.destinations[1]).toMatchObject({ ok: false, error: 'fetch failed' })
    })
  })

  describe('retention', () => {
    const touch = (name: string) => {
      const folder = path.join(dir, 'backups')
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, name), 'x')
    }

    it('keeps the newest routine snapshots and a few safety snapshots, separately', async () => {
      for (let day = 1; day <= 9; day++) touch(`qlcn-2026-09-0${day}T03-00-00Z-periodic.db.gz`)
      for (let day = 1; day <= 5; day++) touch(`qlcn-2026-09-1${day}T03-00-00Z-pre-update.db.gz`)
      touch('notes.txt')

      await pruneLocalSnapshots(path.join(dir, 'backups'), 7, logger)

      const left = fs.readdirSync(path.join(dir, 'backups'))
      expect(left.filter((n) => n.endsWith('periodic.db.gz'))).toHaveLength(7)
      expect(left).not.toContain('qlcn-2026-09-01T03-00-00Z-periodic.db.gz')
      expect(left.filter((n) => n.endsWith('pre-update.db.gz'))).toEqual([
        'qlcn-2026-09-13T03-00-00Z-pre-update.db.gz',
        'qlcn-2026-09-14T03-00-00Z-pre-update.db.gz',
        'qlcn-2026-09-15T03-00-00Z-pre-update.db.gz',
      ])
      expect(left).toContain('notes.txt') // files we do not recognise are never touched
    })

    it('lists snapshots oldest first', async () => {
      touch('qlcn-2026-09-02T03-00-00Z-periodic.db.gz')
      touch('qlcn-2026-09-01T03-00-00Z-manual.db.gz')

      const list = await listLocalSnapshots(path.join(dir, 'backups'))

      expect(list.map((entry) => entry.trigger)).toEqual(['manual', 'periodic'])
    })
  })

  describe('when to back up (event based, not 02:00)', () => {
    const base = new Date('2026-10-11T12:00:00Z')
    const hoursAgo = (hours: number) => new Date(base.getTime() - hours * 3_600_000)

    it('waits a few minutes after startup', () => {
      const decision = decideBackup({ now: base, lastOkAt: null, dirty: true, uptimeMs: BACKUP_STARTUP_DELAY_MS - 1 })

      expect(decision.run).toBe(false)
    })

    it('backs up when there is no backup at all', () => {
      expect(decideBackup({ now: base, lastOkAt: null, dirty: false, uptimeMs: BACKUP_STARTUP_DELAY_MS }).run).toBe(true)
    })

    it('backs up when the last one is older than 24 hours, even without changes', () => {
      const old = new Date(base.getTime() - BACKUP_MAX_AGE_MS - 1000)

      expect(decideBackup({ now: base, lastOkAt: old, dirty: false, uptimeMs: 3_600_000 }).run).toBe(true)
    })

    it('backs up again after 6 hours only if data changed', () => {
      const clean = decideBackup({ now: base, lastOkAt: hoursAgo(7), dirty: false, uptimeMs: 3_600_000 })
      const dirty = decideBackup({ now: base, lastOkAt: hoursAgo(7), dirty: true, uptimeMs: 3_600_000 })
      const recent = decideBackup({ now: base, lastOkAt: hoursAgo(2), dirty: true, uptimeMs: 3_600_000 })

      expect([clean.run, dirty.run, recent.run]).toEqual([false, true, false])
    })
  })

  describe('health warnings', () => {
    const now = new Date('2026-10-15T00:00:00Z')

    const addUser = (createdAt: string) =>
      db
        .prepare(
          `INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'a', 'x', ?)`,
        )
        .run(createdAt)

    const addRun = (destination: string, status: string, finishedAt: string) =>
      db
        .prepare(
          `INSERT INTO backup_runs (id, started_at, finished_at, trigger, destination, status)
           VALUES (?, ?, ?, 'periodic', ?, ?)`,
        )
        .run(`${destination}-${finishedAt}`, finishedAt, finishedAt, destination, status)

    it('stays quiet on a fresh install', () => {
      addUser('2026-10-14T12:00:00Z')

      expect(backupHealth(db, now, true)).toEqual({ lastBackup: null, warnings: [] })
    })

    it('warns when an older install has never been backed up', () => {
      addUser('2026-10-01T00:00:00Z')

      expect(backupHealth(db, now, false).warnings).toEqual(['Chưa có bản sao lưu nào'])
    })

    it('warns when the last good backup is older than 48 hours', () => {
      addUser('2026-10-01T00:00:00Z')
      addRun('local', 'ok', '2026-10-12T00:00:00Z')

      const health = backupHealth(db, now, false)

      expect(health.lastBackup).toEqual({ at: '2026-10-12T00:00:00.000Z', status: 'ok' })
      expect(health.warnings).toEqual(['Đã hơn 48 giờ chưa sao lưu dữ liệu thành công'])
    })

    it('warns about a stale cloud copy only when a cloud destination is configured', () => {
      addUser('2026-10-01T00:00:00Z')
      addRun('local', 'ok', '2026-10-14T23:00:00Z')
      addRun('s3:shop', 'failed', '2026-10-14T23:00:00Z')

      expect(backupHealth(db, now, false).warnings).toEqual([])
      expect(backupHealth(db, now, true).warnings).toEqual(['Đã hơn 48 giờ chưa sao lưu lên cloud'])
    })

    it('is happy when both copies are fresh', () => {
      addUser('2026-10-01T00:00:00Z')
      addRun('local', 'ok', '2026-10-14T23:00:00Z')
      addRun('s3:shop', 'ok', '2026-10-14T23:00:00Z')

      expect(backupHealth(db, now, true).warnings).toEqual([])
    })
  })
})
