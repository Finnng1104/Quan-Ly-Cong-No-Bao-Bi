import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import type { Logger } from 'pino'
import { openDatabase } from '../../db/client.js'
import { getSchemaVersion } from '../../db/migrate.js'
import { listLocalSnapshots, writeCompressedSnapshot } from './service.js'

export type RestoreErrorCode =
  | 'SERVER_RUNNING'
  | 'SOURCE_NOT_FOUND'
  | 'NOT_A_DATABASE'
  | 'CORRUPT'
  | 'NEWER_THAN_CODE'

export class RestoreError extends Error {
  readonly code: RestoreErrorCode

  constructor(code: RestoreErrorCode, message: string) {
    super(message)
    this.name = 'RestoreError'
    this.code = code
  }
}

export interface RestoreInput {
  dbPath: string
  backupsDir: string
  /** A file path, or a YYYY-MM-DD date to take the newest local snapshot of that day. */
  source: string
  /** Highest schema version this build understands (number of migration files). */
  supportedSchemaVersion: number
  logger: Logger
  now(): Date
  isServerRunning(): Promise<boolean>
}

export interface RestoreResult {
  restoredFrom: string
  /** Snapshot of the database as it was just before the restore, so the restore itself can be undone. */
  safetySnapshot: string | null
}

async function resolveSource(input: RestoreInput): Promise<string> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.source)) {
    const snapshots = await listLocalSnapshots(input.backupsDir)
    const ofDay = snapshots.filter((entry) => entry.stamp.startsWith(input.source))
    const newest = ofDay.at(-1)
    if (!newest) throw new RestoreError('SOURCE_NOT_FOUND', `No local backup found for ${input.source}`)
    return path.join(input.backupsDir, newest.fileName)
  }

  const resolved = path.resolve(input.source)
  try {
    await fsp.access(resolved)
  } catch {
    throw new RestoreError('SOURCE_NOT_FOUND', `Backup file not found: ${resolved}`)
  }
  return resolved
}

/**
 * Replaces the live database with a backup. The backup is fully verified before anything is
 * touched, and the current database is snapshotted first, so a bad restore cannot lose data.
 */
export async function restoreFromBackup(input: RestoreInput): Promise<RestoreResult> {
  const log = input.logger.child({ component: 'restore' })
  const source = await resolveSource(input)

  if (await input.isServerRunning()) {
    throw new RestoreError('SERVER_RUNNING', 'Stop the server (service) before restoring a backup')
  }

  await fsp.mkdir(path.dirname(input.dbPath), { recursive: true })
  const candidate = `${input.dbPath}.restore-${randomUUID()}`

  try {
    if (source.endsWith('.gz')) {
      await pipeline(fs.createReadStream(source), createGunzip(), fs.createWriteStream(candidate))
    } else {
      await fsp.copyFile(source, candidate)
    }

    // Verify the candidate on its own before it can replace anything.
    let schemaVersion: number
    try {
      const probe = openDatabase(candidate)
      try {
        const rows = probe.pragma('integrity_check') as { integrity_check: string }[]
        if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') {
          throw new RestoreError('CORRUPT', 'The backup failed its integrity check')
        }
        schemaVersion = getSchemaVersion(probe)
      } finally {
        probe.close()
      }
    } catch (error) {
      if (error instanceof RestoreError) throw error
      throw new RestoreError('NOT_A_DATABASE', `The file is not a valid database: ${(error as Error).message}`)
    }

    if (schemaVersion > input.supportedSchemaVersion) {
      throw new RestoreError(
        'NEWER_THAN_CODE',
        `The backup is from a newer version (schema ${schemaVersion}, this build supports ${input.supportedSchemaVersion})`,
      )
    }

    let safetySnapshot: string | null = null
    if (fs.existsSync(input.dbPath)) {
      const stamp = input.now().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
      safetySnapshot = path.join(input.backupsDir, `qlcn-${stamp}-pre-restore.db.gz`)
      const current = openDatabase(input.dbPath)
      try {
        await writeCompressedSnapshot(current, safetySnapshot)
      } finally {
        current.close()
      }
      log.info({ safetySnapshot }, 'current database saved before restore')
    }

    // The old WAL/SHM files belong to the old database and must not be replayed onto the new one.
    await fsp.rm(input.dbPath, { force: true })
    await fsp.rm(`${input.dbPath}-wal`, { force: true })
    await fsp.rm(`${input.dbPath}-shm`, { force: true })
    await fsp.rename(candidate, input.dbPath)

    log.info({ source }, 'database restored')
    return { restoredFrom: source, safetySnapshot }
  } finally {
    await fsp.rm(candidate, { force: true })
  }
}
