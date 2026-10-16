import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { removeDestination, saveDestination } from '../../cli/backup-setup.js'
import type { BackupDestination, DriveMode, FolderBackupDestination } from '../../config/index.js'
import { authorize } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { parseInput } from '../../shared/validation.js'
import { BACKUP_FILE_NAME_PATTERN } from './cloud.js'
import { RestoreError, stageRestore, type StagedRestore } from './restore.js'
import {
  lastSuccessfulCopy,
  listLocalSnapshots,
  runBackup,
  type BackupDependencies,
  type BackupScheduler,
} from './service.js'
import { createStores, type BackupStore } from './stores.js'

/** Shared with the request gate in app.ts: while true, the API refuses everything but /api/health. */
export interface MaintenanceState {
  restoring: boolean
}

export interface BackupRoutesOptions {
  deps: BackupDependencies
  dbPath: string
  /** Where destinations chosen in Settings are saved so they survive a restart. */
  configFilePath: string
  /** Highest schema version this build understands (number of migration files). */
  supportedSchemaVersion: number
  scheduler: Pick<BackupScheduler, 'noteBackupResult' | 'requestSync'>
  maintenance: MaintenanceState
  /** Folder that lists mounted external drives. Null where the app does not offer drive backup. */
  volumesDir?: string | null
  /**
   * Called once a restore is verified and the current data is saved. The owner of the database
   * must close it, swap the staged file in and exit so the supervisor starts a fresh process.
   */
  requestRestore(staged: StagedRestore): void
}

interface BackupItem {
  fileName: string
  createdAt: string
  trigger: string
  sizeBytes: number | null
  onDevice: boolean
  onDrive: boolean
  online: boolean
}

const restoreBodySchema = z.object({
  fileName: z.string().regex(BACKUP_FILE_NAME_PATTERN, 'Tên bản sao lưu không hợp lệ'),
})

const driveBodySchema = z.object({
  volume: z.string().min(1).max(255).optional(),
  mode: z.enum(['always', 'occasional']),
})

// Lets the browser receive the "restoring" answer before the process goes away.
const RESTART_DELAY_MS = 400
// Inside the chosen drive, so the shop's own files there are never mixed with ours.
const DRIVE_FOLDER_NAME = 'QuanLyCongNo-SaoLuu'

/** `2026-10-11T20-00-00Z` (file name) -> `2026-10-11T20:00:00Z` (ISO). */
const stampToIso = (stamp: string): string => stamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z')

const isDrive = (destination: BackupDestination): destination is FolderBackupDestination =>
  destination.type === 'folder'

export function registerBackupRoutes(app: FastifyInstance, options: BackupRoutesOptions): void {
  const { deps } = options
  const log = deps.logger.child({ component: 'backup' })
  const volumesDir = options.volumesDir === undefined ? '/Volumes' : options.volumesDir

  const storeContext = () => ({ fetchImpl: deps.fetchImpl ?? fetch, now: deps.now })
  const currentStores = (): BackupStore[] => createStores(deps.config, storeContext())
  const currentDrive = (): FolderBackupDestination | null => deps.config.destinations.find(isDrive) ?? null
  const hasCloud = (): boolean => deps.config.destinations.some((destination) => destination.type === 's3')

  /** Volumes that can be picked: real mounted drives, not the startup disk (a link to "/"). */
  async function listVolumes(): Promise<{ name: string; path: string }[]> {
    if (!volumesDir) return []
    let entries
    try {
      entries = await fsp.readdir(volumesDir, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(volumesDir, entry.name) }))
  }

  const driveStatus = async () => {
    const drive = currentDrive()
    if (!drive) return null
    const [store] = createStores({ ...deps.config, destinations: [drive] }, storeContext())
    const lastBackupAt = lastSuccessfulCopy(deps.db, 'folder:')
    return {
      volume: path.basename(path.dirname(drive.path)),
      mode: drive.mode,
      plugged: await (store as BackupStore).isAvailable(),
      lastBackupAt: lastBackupAt ? lastBackupAt.toISOString() : null,
    }
  }

  const lastOkAt = (destinationPattern: string): string | null => {
    const row = deps.db
      .prepare(
        `SELECT finished_at FROM backup_runs
          WHERE destination LIKE ? AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
      )
      .get(destinationPattern) as { finished_at: string } | undefined
    return row?.finished_at ?? null
  }

  app.get('/api/backups', async (request) => {
    authorize(request, 'backup:read')

    const items = new Map<string, BackupItem>()
    const blank = (fileName: string, stamp: string, trigger: string): BackupItem => ({
      fileName,
      createdAt: stampToIso(stamp),
      trigger,
      sizeBytes: null,
      onDevice: false,
      onDrive: false,
      online: false,
    })

    for (const entry of await listLocalSnapshots(deps.backupsDir)) {
      const item = blank(entry.fileName, entry.stamp, entry.trigger)
      item.onDevice = true
      try {
        item.sizeBytes = (await fsp.stat(path.join(deps.backupsDir, entry.fileName))).size
      } catch {
        // Removed between listing and stat; the next refresh will no longer show it.
      }
      items.set(entry.fileName, item)
    }

    let cloudStatus: { configured: boolean; reachable: boolean | null } = { configured: false, reachable: null }
    for (const store of currentStores()) {
      if (store.kind === 's3') cloudStatus = { configured: true, reachable: false }
      try {
        if (!(await store.isAvailable())) continue
        for (const copy of await store.list()) {
          const match = BACKUP_FILE_NAME_PATTERN.exec(copy.fileName)
          const item = items.get(copy.fileName) ?? blank(copy.fileName, match?.[1] ?? '', match?.[2] ?? 'unknown')
          item.sizeBytes ??= copy.sizeBytes
          if (store.kind === 'folder') item.onDrive = true
          else item.online = true
          items.set(copy.fileName, item)
        }
        if (store.kind === 's3') cloudStatus.reachable = true
      } catch (error) {
        // Offline is an everyday state for a shop computer: show what the other places hold.
        log.info({ err: error, destination: store.label }, 'backup copies not reachable')
      }
    }

    return {
      cloud: cloudStatus,
      drive: await driveStatus(),
      drivesSupported: volumesDir !== null,
      lastBackupAt: lastOkAt('local'),
      lastCloudBackupAt: hasCloud() ? lastOkAt('s3:%') : null,
      items: [...items.values()].sort((a, b) => (a.fileName < b.fileName ? 1 : a.fileName > b.fileName ? -1 : 0)),
    }
  })

  app.post('/api/backups', async (request) => {
    authorize(request, 'backup:write')

    const result = await runBackup(deps, 'manual')
    if (!result.ok) {
      const alreadyRunning = result.destinations.length === 0
      throw new AppError(
        alreadyRunning ? 'CONFLICT' : 'INTERNAL',
        alreadyRunning ? 'Đang sao lưu, vui lòng đợi một chút' : 'Không sao lưu được, vui lòng thử lại',
      )
    }
    options.scheduler.noteBackupResult(result)

    // null: that place is not set up. false: set up but not reached (it is retried by itself).
    const outcomeOf = (kind: 'folder' | 's3'): boolean | null => {
      const outcome = result.destinations.find((destination) => destination.kind === kind)
      return outcome ? outcome.ok : null
    }
    return {
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      uploaded: outcomeOf('s3'),
      copiedToDrive: outcomeOf('folder'),
    }
  })

  app.get('/api/backups/drives', async (request) => {
    authorize(request, 'backup:read')
    return { drives: await listVolumes() }
  })

  app.put('/api/backups/drive', async (request) => {
    authorize(request, 'backup:write')
    if (!volumesDir) throw new AppError('NOT_FOUND', 'Máy này chưa hỗ trợ sao lưu ra ổ cứng ngoài')
    const body = parseInput(driveBodySchema, request.body)

    const existing = currentDrive()
    let folderPath = existing?.path ?? null
    if (body.volume !== undefined) {
      // Only a drive that is mounted right now can be picked, never a path typed by the caller.
      const volume = (await listVolumes()).find((candidate) => candidate.name === body.volume)
      if (!volume) throw new AppError('NOT_FOUND', 'Không thấy ổ này. Hãy cắm ổ vào máy rồi thử lại.')
      folderPath = path.join(volume.path, DRIVE_FOLDER_NAME)
    }
    if (!folderPath) throw new AppError('VALIDATION_ERROR', 'Hãy chọn một ổ cứng ngoài')

    const destination: FolderBackupDestination = { type: 'folder', path: folderPath, mode: body.mode as DriveMode }

    // Prove we may write there now, so a missing permission shows up here and not as a silent
    // failure at the next backup. macOS asks for access to removable drives the first time.
    const [store] = createStores({ ...deps.config, destinations: [destination] }, storeContext())
    const probePath = path.join(deps.backupsDir, `.drive-test-${randomUUID()}`)
    try {
      await fsp.mkdir(deps.backupsDir, { recursive: true })
      await fsp.writeFile(probePath, 'ok')
      const probeName = 'qlcn-2000-01-01T00-00-00Z-test.db.gz'
      await (store as BackupStore).put(probeName, probePath)
      await (store as BackupStore).remove(probeName)
    } catch (error) {
      log.warn({ err: error, folderPath }, 'cannot write to the chosen drive')
      throw new AppError(
        'UNAVAILABLE',
        'Phần mềm chưa ghi được vào ổ này. Nếu máy hiện hộp hỏi quyền truy cập ổ đĩa, hãy chọn Cho phép; ' +
          'hoặc kiểm tra ổ không bị khóa ghi.',
      )
    } finally {
      await fsp.rm(probePath, { force: true })
    }

    saveDestination(options.configFilePath, destination)
    deps.config.destinations = [...deps.config.destinations.filter((entry) => !isDrive(entry)), destination]
    options.scheduler.requestSync()
    log.info({ folderPath, mode: destination.mode }, 'external drive backup enabled')
    return driveStatus()
  })

  app.delete('/api/backups/drive', async (request) => {
    authorize(request, 'backup:write')
    removeDestination(options.configFilePath, 'folder')
    deps.config.destinations = deps.config.destinations.filter((entry) => !isDrive(entry))
    log.info('external drive backup turned off')
    return { ok: true }
  })

  app.post('/api/backups/restore', async (request) => {
    authorize(request, 'backup:restore')
    const { fileName } = parseInput(restoreBodySchema, request.body)
    if (options.maintenance.restoring) {
      throw new AppError('CONFLICT', 'Đang khôi phục dữ liệu, vui lòng đợi')
    }

    const localPath = path.join(deps.backupsDir, fileName)
    let sourcePath = localPath
    let downloadedPath: string | null = null

    try {
      const onDevice = await fsp.access(localPath).then(
        () => true,
        () => false,
      )
      if (!onDevice) {
        const store = await findStoreHolding(currentStores(), fileName)
        if (!store) {
          throw new AppError(
            hasCloud() || currentDrive() ? 'UNAVAILABLE' : 'NOT_FOUND',
            hasCloud() || currentDrive()
              ? 'Không lấy được bản sao lưu này. Hãy cắm ổ cứng ngoài hoặc kiểm tra kết nối mạng rồi thử lại.'
              : 'Không tìm thấy bản sao lưu này',
          )
        }
        // The .gz suffix matters: it is how the restore code knows the file is compressed.
        downloadedPath = path.join(deps.backupsDir, `.download-${randomUUID()}.db.gz`)
        try {
          await store.fetch(fileName, downloadedPath)
        } catch (error) {
          log.warn({ err: error, fileName, destination: store.label }, 'cannot fetch backup copy')
          throw new AppError('UNAVAILABLE', 'Không lấy được bản sao lưu này. Hãy thử lại.')
        }
        sourcePath = downloadedPath
      }

      let staged: StagedRestore
      try {
        staged = await stageRestore({
          db: deps.db,
          dbPath: options.dbPath,
          backupsDir: deps.backupsDir,
          sourcePath,
          supportedSchemaVersion: options.supportedSchemaVersion,
          logger: deps.logger,
          now: deps.now,
        })
      } catch (error) {
        if (error instanceof RestoreError) {
          log.warn({ code: error.code, fileName }, error.message)
          throw new AppError(
            'VALIDATION_ERROR',
            error.code === 'NEWER_THAN_CODE'
              ? 'Bản sao lưu này tạo bởi phiên bản mới hơn. Hãy cập nhật phần mềm trước.'
              : 'Bản sao lưu này bị hỏng hoặc không dùng được. Hãy chọn bản khác.',
          )
        }
        throw error
      }

      options.maintenance.restoring = true
      log.info({ fileName, safetySnapshot: staged.safetySnapshot }, 'restore requested from the app')
      setTimeout(() => options.requestRestore(staged), RESTART_DELAY_MS)

      return { restarting: true, savedCurrentAs: path.basename(staged.safetySnapshot) }
    } finally {
      if (downloadedPath) await fsp.rm(downloadedPath, { force: true })
    }
  })
}

/** First reachable store (drive before online, as it is faster) that holds `fileName`. */
async function findStoreHolding(stores: BackupStore[], fileName: string): Promise<BackupStore | null> {
  const ordered = [...stores].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1))
  for (const store of ordered) {
    try {
      if (!(await store.isAvailable())) continue
      if ((await store.list()).some((copy) => copy.fileName === fileName)) return store
    } catch {
      // Unreachable right now; try the next place.
    }
  }
  return null
}
