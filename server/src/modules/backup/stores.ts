import fsp from 'node:fs/promises'
import path from 'node:path'
import type { BackupConfig, BackupDestination } from '../../config/index.js'
import {
  BACKUP_FILE_NAME_PATTERN,
  deleteCloudBackup,
  downloadCloudBackup,
  listCloudBackups,
  uploadCloudBackup,
} from './cloud.js'

export interface StoredCopy {
  fileName: string
  sizeBytes: number
}

/**
 * A place that holds copies of the snapshots besides the shop computer: an external drive or an
 * online bucket. Both behave the same for the rest of the backup code, which is what lets a shop
 * use either, both, or neither.
 */
export interface BackupStore {
  /** Also the `destination` recorded in backup_runs, e.g. `folder:/Volumes/Backup/QuanLyCongNo`. */
  label: string
  kind: 'folder' | 's3'
  /** False while an external drive is unplugged. An online store is only found unreachable by trying. */
  isAvailable(): Promise<boolean>
  /** Copies, oldest first. */
  list(): Promise<StoredCopy[]>
  put(fileName: string, localPath: string): Promise<void>
  fetch(fileName: string, targetPath: string): Promise<void>
  remove(fileName: string): Promise<void>
}

export interface StoreContext {
  fetchImpl: typeof fetch
  now(): Date
}

const byFileName = (a: StoredCopy, b: StoredCopy): number =>
  a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0

/**
 * The volume a folder lives on. For /Volumes/Backup/QuanLyCongNo that is /Volumes/Backup: when the
 * drive is unplugged this path is gone, and creating the folder anyway would silently fill the
 * internal disk while looking like a successful backup.
 */
export function mountPointOf(folderPath: string): string {
  const parts = path.resolve(folderPath).split(path.sep).filter(Boolean)
  if (parts[0] === 'Volumes' && parts.length >= 2) return path.join(path.sep, 'Volumes', parts[1] as string)
  return path.dirname(path.resolve(folderPath))
}

function folderStore(folderPath: string): BackupStore {
  return {
    label: `folder:${folderPath}`,
    kind: 'folder',
    async isAvailable() {
      try {
        return (await fsp.stat(mountPointOf(folderPath))).isDirectory()
      } catch {
        return false
      }
    },
    async list() {
      let names: string[]
      try {
        names = await fsp.readdir(folderPath)
      } catch {
        return []
      }
      const copies: StoredCopy[] = []
      for (const fileName of names.filter((name) => BACKUP_FILE_NAME_PATTERN.test(name))) {
        try {
          copies.push({ fileName, sizeBytes: (await fsp.stat(path.join(folderPath, fileName))).size })
        } catch {
          // Disappeared while listing (drive removed): leave it out.
        }
      }
      return copies.sort(byFileName)
    },
    async put(fileName, localPath) {
      await fsp.mkdir(folderPath, { recursive: true })
      // Copy under a temporary name first so pulling the drive out never leaves a half file that
      // looks like a complete backup.
      const finalPath = path.join(folderPath, fileName)
      const partialPath = `${finalPath}.partial`
      await fsp.copyFile(localPath, partialPath)
      await fsp.rename(partialPath, finalPath)
    },
    async fetch(fileName, targetPath) {
      await fsp.copyFile(path.join(folderPath, fileName), targetPath)
    },
    async remove(fileName) {
      await fsp.rm(path.join(folderPath, fileName), { force: true })
    },
  }
}

function s3Store(
  destination: Extract<BackupDestination, { type: 's3' }>,
  context: StoreContext,
): BackupStore {
  const call = () => ({ destination, fetchImpl: context.fetchImpl, now: context.now() })
  return {
    label: `s3:${destination.bucket}`,
    kind: 's3',
    isAvailable: async () => true,
    async list() {
      const objects = await listCloudBackups(call())
      return objects.map((object) => ({ fileName: object.fileName, sizeBytes: object.sizeBytes }))
    },
    async put(fileName, localPath) {
      await uploadCloudBackup(call(), fileName, await fsp.readFile(localPath))
    },
    fetch: (fileName, targetPath) => downloadCloudBackup(call(), fileName, targetPath),
    remove: (fileName) => deleteCloudBackup(call(), fileName),
  }
}

/** Built on demand from the current config, so a drive chosen in Settings takes effect at once. */
export function createStores(config: BackupConfig, context: StoreContext): BackupStore[] {
  return config.destinations.map((destination) =>
    destination.type === 'folder' ? folderStore(destination.path) : s3Store(destination, context),
  )
}
