import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptureLogger, makeTempDir, removeDir } from '../../../test/helpers/index.js'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'
import { createFakeS3, type FakeS3 } from '../../../test/helpers/fake-s3.js'
import type { S3BackupDestination } from '../../config/index.js'
import type { StagedRestore } from './restore.js'
import type { BackupDependencies } from './service.js'

const destination: S3BackupDestination = {
  type: 's3',
  endpoint: 'https://acct.r2.cloudflarestorage.com',
  bucket: 'shop',
  region: 'auto',
  accessKeyId: 'AKIA-TEST',
  secretAccessKey: 'secret-key',
  prefix: '',
}

describe('backup routes', () => {
  let dir: string
  let backupsDir: string
  let s3: FakeS3
  let t: TestApp
  let restoreRequests: StagedRestore[]
  const { logger } = createCaptureLogger()

  let volumesDir: string
  let configFilePath: string

  const start = async (options: { withCloud: boolean; drive?: { volume: string; mode: 'always' | 'occasional' } }) => {
    restoreRequests = []
    t = await createTestApp({
      backup: (db) => ({
        deps: {
          db,
          backupsDir,
          config: {
            localRetention: 7,
            destinationRetention: 30,
            destinations: [
              ...(options.withCloud ? [destination] : []),
              ...(options.drive
                ? [
                    {
                      type: 'folder' as const,
                      path: path.join(volumesDir, options.drive.volume, 'QuanLyCongNo-SaoLuu'),
                      mode: options.drive.mode,
                    },
                  ]
                : []),
            ],
          },
          logger,
          now: () => new Date('2026-10-11T03:00:00Z'),
          fetchImpl: s3.fetchImpl,
        } satisfies BackupDependencies,
        dbPath: path.join(dir, 'data', 'app.db'),
        configFilePath,
        volumesDir,
        // Stands in for `diskutil`: volumes named like installers are not drives.
        inspectVolume: async (volumePath: string) => ({
          eligible: !path.basename(volumePath).startsWith('Installer'),
          freeBytes: 1_000_000_000,
        }),
        supportedSchemaVersion: 2,
        scheduler: { noteBackupResult: () => undefined, requestSync: () => undefined },
        requestRestore: (staged) => restoreRequests.push(staged),
      }),
    })
  }

  beforeEach(() => {
    dir = makeTempDir()
    backupsDir = path.join(dir, 'backups')
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    volumesDir = path.join(dir, 'Volumes')
    fs.mkdirSync(path.join(volumesDir, 'Backup Drive'), { recursive: true })
    configFilePath = path.join(dir, 'config.json')
    s3 = createFakeS3()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await t.close()
    removeDir(dir)
  })

  it('requires a session', async () => {
    await start({ withCloud: false })
    const response = await t.anonymous.get('/api/backups')
    expect(response.status).toBe(401)
  })

  describe('listing', () => {
    it('shows device and online copies together, newest first', async () => {
      await start({ withCloud: true })
      const only = await t.api.post('/api/backups')
      expect(only.status).toBe(200)
      s3.objects.set('qlcn-2026-10-01T05-00-00Z-startup.db.gz', Buffer.from('old'))

      const response = await t.api.get('/api/backups')

      expect(response.body.cloud).toEqual({ configured: true, reachable: true })
      expect(response.body.items.map((item: { fileName: string }) => item.fileName)).toEqual([
        'qlcn-2026-10-11T03-00-00Z-manual.db.gz',
        'qlcn-2026-10-01T05-00-00Z-startup.db.gz',
      ])
      expect(response.body.items[0]).toMatchObject({ onDevice: true, online: true, trigger: 'manual' })
      expect(response.body.items[1]).toMatchObject({
        onDevice: false,
        online: true,
        createdAt: '2026-10-01T05:00:00Z',
      })
      expect(response.body.lastCloudBackupAt).not.toBeNull()
    })

    it('falls back to the device list when offline, without leaking details', async () => {
      await start({ withCloud: true })
      await t.api.post('/api/backups')
      s3.setOffline(true)

      const response = await t.api.get('/api/backups')

      expect(response.status).toBe(200)
      expect(response.body.cloud).toEqual({ configured: true, reachable: false })
      expect(response.body.items).toHaveLength(1)
      expect(JSON.stringify(response.body)).not.toContain('secret-key')
    })

    it('reports that no online backup is configured', async () => {
      await start({ withCloud: false })
      const response = await t.api.get('/api/backups')
      expect(response.body.cloud).toEqual({ configured: false, reachable: null })
    })
  })

  describe('back up now', () => {
    it('creates a snapshot and says whether it reached the cloud', async () => {
      await start({ withCloud: true })

      const response = await t.api.post('/api/backups')

      expect(response.body).toMatchObject({ fileName: 'qlcn-2026-10-11T03-00-00Z-manual.db.gz', uploaded: true })
      expect(s3.objects.has('qlcn-2026-10-11T03-00-00Z-manual.db.gz')).toBe(true)
    })

    it('still succeeds locally while offline', async () => {
      await start({ withCloud: true })
      s3.setOffline(true)

      const response = await t.api.post('/api/backups')

      expect(response.status).toBe(200)
      expect(response.body.uploaded).toBe(false)
      expect(fs.existsSync(path.join(backupsDir, response.body.fileName))).toBe(true)
    })
  })

  describe('restore', () => {
    it('stages a verified local backup, saves the current data and asks for a restart', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      await start({ withCloud: false })
      const created = await t.api.post('/api/backups')

      const response = await t.api.post('/api/backups/restore', { fileName: created.body.fileName })

      expect(response.status).toBe(200)
      expect(response.body.restarting).toBe(true)
      expect(response.body.savedCurrentAs).toMatch(/-pre-restore\.db\.gz$/)
      expect(fs.existsSync(path.join(backupsDir, response.body.savedCurrentAs))).toBe(true)

      vi.runAllTimers()
      expect(restoreRequests).toHaveLength(1)
      expect(fs.existsSync(restoreRequests[0]?.candidatePath as string)).toBe(true)
    })

    it('refuses further API calls while the restart is pending', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      await start({ withCloud: false })
      const created = await t.api.post('/api/backups')
      await t.api.post('/api/backups/restore', { fileName: created.body.fileName })

      const during = await t.api.get('/api/settings')
      const health = await t.anonymous.get('/api/health')

      expect(during.status).toBe(503)
      expect(health.status).toBe(200)
    })

    it('downloads a cloud-only backup and leaves no temporary file behind', async () => {
      await start({ withCloud: true })
      // Take a real snapshot, then keep only the cloud copy.
      const created = await t.api.post('/api/backups')
      const name = created.body.fileName as string
      fs.rmSync(path.join(backupsDir, name))
      expect(s3.objects.has(name)).toBe(true)
      vi.useFakeTimers({ toFake: ['setTimeout'] })

      const response = await t.api.post('/api/backups/restore', { fileName: name })

      expect(response.status).toBe(200)
      const leftovers = fs.readdirSync(backupsDir).filter((file) => file.startsWith('.download-'))
      expect(leftovers).toEqual([])
    })

    it('tells the person when a cloud copy cannot be fetched', async () => {
      await start({ withCloud: true })
      s3.setOffline(true)

      const response = await t.api.post('/api/backups/restore', {
        fileName: 'qlcn-2026-10-01T05-00-00Z-startup.db.gz',
      })

      expect(response.status).toBe(503)
      expect(response.body.error.message).toContain('kết nối mạng')
    })

    it('rejects file names that are not our backups', async () => {
      await start({ withCloud: false })
      for (const fileName of ['../../etc/passwd', 'app.db', 'qlcn-x.db.gz']) {
        const response = await t.api.post('/api/backups/restore', { fileName })
        expect(response.status).toBe(400)
      }
    })

    it('answers 404 for a backup that exists nowhere', async () => {
      await start({ withCloud: false })
      const response = await t.api.post('/api/backups/restore', {
        fileName: 'qlcn-2026-10-01T05-00-00Z-startup.db.gz',
      })
      expect(response.status).toBe(404)
    })

    it('refuses a damaged backup and leaves everything as it was', async () => {
      await start({ withCloud: false })
      fs.mkdirSync(backupsDir, { recursive: true })
      const fileName = 'qlcn-2026-10-01T05-00-00Z-startup.db.gz'
      fs.writeFileSync(path.join(backupsDir, fileName), gzipSync(Buffer.from('this is not a database')))

      const response = await t.api.post('/api/backups/restore', { fileName })

      expect(response.status).toBe(400)
      expect(restoreRequests).toHaveLength(0)
      expect((await t.api.get('/api/settings')).status).toBe(200)
      expect(fs.readdirSync(path.join(dir, 'data')).filter((f) => f.includes('.restore-'))).toEqual([])
    })
  })

  describe('external drive', () => {
    it('lists mounted drives and ignores hidden entries', async () => {
      fs.mkdirSync(path.join(volumesDir, '.timemachine'))
      await start({ withCloud: false })

      const response = await t.api.get('/api/backups/drives')

      expect(response.body.drives).toEqual([
        { name: 'Backup Drive', path: path.join(volumesDir, 'Backup Drive'), freeBytes: 1_000_000_000 },
      ])
    })

    it('hides installer images and refuses to choose one', async () => {
      fs.mkdirSync(path.join(volumesDir, 'Installer Zalo'))
      await start({ withCloud: false })

      const listed = await t.api.get('/api/backups/drives')
      const chosen = await t.api.put('/api/backups/drive', { volume: 'Installer Zalo', mode: 'always' })

      expect(listed.body.drives.map((drive: { name: string }) => drive.name)).toEqual(['Backup Drive'])
      expect(chosen.status).toBe(404)
    })

    it('chooses a drive, saves it and copies backups to it', async () => {
      await start({ withCloud: false })

      const chosen = await t.api.put('/api/backups/drive', { volume: 'Backup Drive', mode: 'occasional' })

      expect(chosen.status).toBe(200)
      expect(chosen.body).toMatchObject({ volume: 'Backup Drive', mode: 'occasional', plugged: true })
      const saved = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
      expect(saved.backup.destinations[0]).toMatchObject({ type: 'folder', mode: 'occasional' })

      const created = await t.api.post('/api/backups')
      expect(created.body.copiedToDrive).toBe(true)
      const folder = path.join(volumesDir, 'Backup Drive', 'QuanLyCongNo-SaoLuu')
      expect(fs.readdirSync(folder)).toEqual([created.body.fileName])

      const listing = await t.api.get('/api/backups')
      expect(listing.body.items[0]).toMatchObject({ onDevice: true, onDrive: true, online: false })
    })

    it('refuses a drive that is not mounted and never accepts a typed path', async () => {
      await start({ withCloud: false })

      for (const volume of ['Not Plugged', '../../etc']) {
        const response = await t.api.put('/api/backups/drive', { volume, mode: 'always' })
        expect(response.status).toBe(404)
      }
      expect(fs.existsSync(configFilePath)).toBe(false)
    })

    it('says the drive is unplugged and keeps the local backup working', async () => {
      await start({ withCloud: false, drive: { volume: 'Gone Drive', mode: 'always' } })

      const created = await t.api.post('/api/backups')
      const listing = await t.api.get('/api/backups')

      expect(created.status).toBe(200)
      expect(created.body.copiedToDrive).toBe(false)
      expect(listing.body.drive).toMatchObject({ volume: 'Gone Drive', plugged: false })
      expect(fs.existsSync(path.join(volumesDir, 'Gone Drive'))).toBe(false)
    })

    it('restores a backup that exists only on the drive', async () => {
      await start({ withCloud: false, drive: { volume: 'Backup Drive', mode: 'always' } })
      const created = await t.api.post('/api/backups')
      fs.rmSync(path.join(backupsDir, created.body.fileName))
      vi.useFakeTimers({ toFake: ['setTimeout'] })

      const response = await t.api.post('/api/backups/restore', { fileName: created.body.fileName })

      expect(response.status).toBe(200)
      expect(fs.readdirSync(backupsDir).filter((file) => file.startsWith('.download-'))).toEqual([])
    })

    it('turns the drive off without touching what is on it', async () => {
      await start({ withCloud: false })
      await t.api.put('/api/backups/drive', { volume: 'Backup Drive', mode: 'always' })
      await t.api.post('/api/backups')

      const response = await t.api.delete('/api/backups/drive')

      expect(response.status).toBe(200)
      expect((await t.api.get('/api/backups')).body.drive).toBeNull()
      const folder = path.join(volumesDir, 'Backup Drive', 'QuanLyCongNo-SaoLuu')
      expect(fs.readdirSync(folder)).toHaveLength(1)
    })
  })
})
