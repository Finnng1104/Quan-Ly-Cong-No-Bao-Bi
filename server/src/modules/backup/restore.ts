import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import type { Logger } from 'pino'
import { openDatabase, type Database } from '../../db/client.js'
import { getSchemaVersion } from '../../db/migrate.js'
import { todayInShopZone } from '../../shared/dates.js'
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
  /** A file path, or a YYYY-MM-DD date (shop time) to take the newest local snapshot of that day. */
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

/** Shop-time date of a snapshot. File names carry UTC, e.g. 2026-10-11T20-00-00Z is 12/10 in Vietnam. */
function shopDateOfStamp(stamp: string): string {
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z')
  return todayInShopZone(new Date(iso))
}

async function resolveSource(input: RestoreInput): Promise<string> {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.source)) {
    const snapshots = await listLocalSnapshots(input.backupsDir)
    const ofDay = snapshots.filter((entry) => shopDateOfStamp(entry.stamp) === input.source)
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

/** Unpacks `source` into `candidate` and proves it is a healthy database this build can open. */
async function unpackAndVerify(
  source: string,
  candidate: string,
  supportedSchemaVersion: number,
): Promise<void> {
  if (source.endsWith('.gz')) {
    await pipeline(fs.createReadStream(source), createGunzip(), fs.createWriteStream(candidate))
  } else {
    await fsp.copyFile(source, candidate)
  }

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

  if (schemaVersion > supportedSchemaVersion) {
    throw new RestoreError(
      'NEWER_THAN_CODE',
      `The backup is from a newer version (schema ${schemaVersion}, this build supports ${supportedSchemaVersion})`,
    )
  }
}

/**
 * Puts a verified candidate in place of the database file.
 * The old WAL/SHM files belong to the old database and must not be replayed onto the new one, and
 * rename() swaps the file in one step, so a power cut leaves either the old or the new database,
 * never none (which would make the next start create an empty one).
 */
export async function replaceDatabaseFile(dbPath: string, candidate: string): Promise<void> {
  await fsp.rm(`${dbPath}-wal`, { force: true })
  await fsp.rm(`${dbPath}-shm`, { force: true })
  await fsp.rename(candidate, dbPath)
}

function safetySnapshotPath(backupsDir: string, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
  return path.join(backupsDir, `qlcn-${stamp}-pre-restore.db.gz`)
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
    await unpackAndVerify(source, candidate, input.supportedSchemaVersion)

    let safetySnapshot: string | null = null
    if (fs.existsSync(input.dbPath)) {
      safetySnapshot = safetySnapshotPath(input.backupsDir, input.now())
      const current = openDatabase(input.dbPath)
      try {
        await writeCompressedSnapshot(current, safetySnapshot)
      } finally {
        current.close()
      }
      log.info({ safetySnapshot }, 'current database saved before restore')
    }

    await replaceDatabaseFile(input.dbPath, candidate)

    log.info({ source }, 'database restored')
    return { restoredFrom: source, safetySnapshot }
  } finally {
    await fsp.rm(candidate, { force: true })
  }
}

export interface StageRestoreInput {
  /** The database the running server is using. */
  db: Database
  dbPath: string
  backupsDir: string
  /** A backup file already on this machine (a cloud copy must be downloaded first). */
  sourcePath: string
  supportedSchemaVersion: number
  logger: Logger
  now(): Date
}

export interface StagedRestore {
  /** Verified database file waiting next to the live one; swap it in with `replaceDatabaseFile`. */
  candidatePath: string
  safetySnapshot: string
}

/**
 * First half of a restore done while the server is running: verify the backup and save the current
 * data. The swap itself happens after the server has closed its database (see main.ts), so no
 * request can write into a database that is about to be replaced.
 */
export async function stageRestore(input: StageRestoreInput): Promise<StagedRestore> {
  const candidatePath = `${input.dbPath}.restore-${randomUUID()}`
  try {
    await unpackAndVerify(input.sourcePath, candidatePath, input.supportedSchemaVersion)
    const safetySnapshot = safetySnapshotPath(input.backupsDir, input.now())
    await writeCompressedSnapshot(input.db, safetySnapshot)
    input.logger.child({ component: 'restore' }).info({ safetySnapshot }, 'restore staged')
    return { candidatePath, safetySnapshot }
  } catch (error) {
    await fsp.rm(candidatePath, { force: true })
    throw error
  }
}
