import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger, makeTempDir, removeDir, waitFor } from '../../../test/helpers/index.js'
import { createFakeS3, type FakeS3 } from '../../../test/helpers/fake-s3.js'
import type { S3BackupDestination } from '../../config/index.js'
import { openDatabase, type Database } from '../../db/client.js'
import { loadMigrationFiles, runMigrations } from '../../db/migrate.js'
import { deleteCloudBackup, listCloudBackups, probeCloudDestination } from './cloud.js'
import {
  runBackup,
  startBackupScheduler,
  syncDestinations,
  type BackupDependencies,
} from './service.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))

const destination: S3BackupDestination = {
  type: 's3',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'shop',
  region: 'auto',
  accessKeyId: 'AKIA-TEST',
  secretAccessKey: 'secret-key',
  prefix: 'qlcn/',
}

describe('cloud backups', () => {
  let dir: string
  let db: Database
  let clock: Date
  let s3: FakeS3
  const { logger } = createCaptureLogger()

  const deps = (overrides: Partial<BackupDependencies> = {}): BackupDependencies => ({
    db,
    backupsDir: path.join(dir, 'backups'),
    config: { localRetention: 7, destinationRetention: 30, destinations: [destination] },
    logger,
    now: () => clock,
    fetchImpl: s3.fetchImpl,
    ...overrides,
  })
  const call = () => ({ destination, fetchImpl: s3.fetchImpl, now: clock })
  const snapshotAt = async (iso: string) => {
    clock = new Date(iso)
    return runBackup(deps(), 'periodic')
  }

  beforeEach(() => {
    dir = makeTempDir()
    clock = new Date('2026-10-11T03:00:00Z')
    s3 = createFakeS3()
    db = openDatabase(path.join(dir, 'app.db'))
    runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
  })

  afterEach(() => {
    db.close()
    removeDir(dir)
  })

  describe('listing', () => {
    it('returns only backup files under the prefix, oldest first, across pages', async () => {
      for (let hour = 10; hour >= 0; hour--) {
        const stamp = `2026-10-11T${String(hour).padStart(2, '0')}-00-00Z`
        s3.objects.set(`qlcn/qlcn-${stamp}-periodic.db.gz`, Buffer.from('x'))
      }
      s3.objects.set('qlcn/notes.txt', Buffer.from('x'))
      s3.objects.set('other/qlcn-2026-10-11T00-00-00Z-periodic.db.gz', Buffer.from('x'))

      const listed = await listCloudBackups(call())

      expect(listed).toHaveLength(11)
      expect(listed[0]?.fileName).toBe('qlcn-2026-10-11T00-00-00Z-periodic.db.gz')
      expect(listed.at(-1)?.fileName).toBe('qlcn-2026-10-11T10-00-00Z-periodic.db.gz')
    })

    it('fails when the credentials are rejected', async () => {
      const denied = (async () => new Response('AccessDenied', { status: 403 })) as unknown as typeof fetch
      await expect(listCloudBackups({ ...call(), fetchImpl: denied })).rejects.toThrow('403')
    })
  })

  describe('connection probe', () => {
    it('lists, writes and deletes, leaving the bucket as it was', async () => {
      await probeCloudDestination(call())

      expect(s3.requests.map((r) => r.method)).toEqual(['GET', 'PUT', 'DELETE'])
      expect(s3.objects.size).toBe(0)
    })
  })

  describe('syncDestinations', () => {
    it('uploads snapshots taken while offline once the network is back', async () => {
      s3.setOffline(true)
      const first = await snapshotAt('2026-10-11T03:00:00Z')
      const second = await snapshotAt('2026-10-11T09:00:00Z')
      // Offline: the local copies exist, the cloud copies do not.
      expect(first.destinations[1]).toMatchObject({ ok: false })
      expect(s3.objects.size).toBe(0)

      s3.setOffline(false)
      const [outcome] = await syncDestinations(deps())

      expect(outcome).toMatchObject({ ok: true })
      expect(outcome?.copied).toEqual([first.fileName, second.fileName])
      expect([...s3.objects.keys()]).toEqual([`qlcn/${first.fileName}`, `qlcn/${second.fileName}`])
    })

    it('uploads nothing when the cloud already has every snapshot', async () => {
      await snapshotAt('2026-10-11T03:00:00Z')
      s3.requests.length = 0

      const [outcome] = await syncDestinations(deps())

      expect(outcome).toMatchObject({ ok: true, copied: [], pruned: [] })
      expect(s3.requests.map((r) => r.method)).toEqual(['GET'])
    })

    it('reports an unreachable cloud instead of throwing', async () => {
      await snapshotAt('2026-10-11T03:00:00Z')
      s3.setOffline(true)

      const [outcome] = await syncDestinations(deps())

      expect(outcome).toMatchObject({ ok: false, error: 'fetch failed' })
    })

    it('keeps only the newest copies beyond the retention limit', async () => {
      await snapshotAt('2026-10-11T03:00:00Z')
      await snapshotAt('2026-10-11T09:00:00Z')
      const newest = await snapshotAt('2026-10-11T15:00:00Z')
      const config = { localRetention: 7, destinationRetention: 3, destinations: [destination] }
      s3.objects.set('qlcn/qlcn-2026-10-01T00-00-00Z-periodic.db.gz', Buffer.from('old'))

      const [outcome] = await syncDestinations(deps({ config }))

      expect(outcome?.pruned).toEqual(['qlcn-2026-10-01T00-00-00Z-periodic.db.gz'])
      expect(s3.objects.size).toBe(3)
      expect(s3.objects.has(`qlcn/${newest.fileName}`)).toBe(true)
    })

    it('does nothing without a cloud destination', async () => {
      const config = { localRetention: 7, destinationRetention: 30, destinations: [] }
      expect(await syncDestinations(deps({ config }))).toEqual([])
    })
  })

  describe('delete', () => {
    it('removes one object', async () => {
      s3.objects.set('qlcn/qlcn-2026-10-11T00-00-00Z-periodic.db.gz', Buffer.from('x'))
      await deleteCloudBackup(call(), 'qlcn-2026-10-11T00-00-00Z-periodic.db.gz')
      expect(s3.objects.size).toBe(0)
    })
  })

  describe('scheduler', () => {
    it('retries the upload by itself when the network returns', async () => {
      s3.setOffline(true)
      const first = await snapshotAt('2026-10-11T03:00:00Z')
      s3.setOffline(false)

      // The process has been up for an hour by the time the first check runs.
      const start = new Date('2026-10-11T03:00:00Z')
      clock = start
      const scheduler = startBackupScheduler(deps(), { checkIntervalMs: 10, networkRetryMs: 0 })
      clock = new Date(start.getTime() + 60 * 60_000)

      try {
        await waitFor(() => s3.objects.has(`qlcn/${first.fileName}`), { description: 'queued upload' })
      } finally {
        scheduler.stop()
      }
      expect(fs.existsSync(path.join(dir, 'backups', first.fileName as string))).toBe(true)
    })
  })
})
