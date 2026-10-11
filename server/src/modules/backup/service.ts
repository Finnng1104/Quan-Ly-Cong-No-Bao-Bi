import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import type { Logger } from 'pino'
import type { BackupConfig, BackupDestination, S3BackupDestination } from '../../config/index.js'
import type { Database } from '../../db/client.js'
import { signRequest } from './sigv4.js'

export type BackupTrigger = 'startup' | 'periodic' | 'pre-update' | 'pre-restore' | 'manual'

/** Snapshots taken for safety around risky operations are retained separately from routine ones. */
const SAFETY_TRIGGERS: readonly BackupTrigger[] = ['pre-update', 'pre-restore']
const SAFETY_SNAPSHOTS_TO_KEEP = 3
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const FILE_NAME_PATTERN = /^qlcn-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z)-([a-z-]+)\.db\.gz$/

export interface DestinationOutcome {
  destination: string
  ok: boolean
  error?: string
}

export interface BackupResult {
  ok: boolean
  fileName: string | null
  localPath: string | null
  sizeBytes: number | null
  destinations: DestinationOutcome[]
}

export interface BackupDependencies {
  db: Database
  backupsDir: string
  config: BackupConfig
  logger: Logger
  now(): Date
  /** Override for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

const describeDestination = (destination: BackupDestination): string =>
  destination.type === 'folder' ? `folder:${destination.path}` : `s3:${destination.bucket}`

function snapshotFileName(now: Date, trigger: BackupTrigger): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
  return `qlcn-${stamp}-${trigger}.db.gz`
}

function recordRun(
  db: Database,
  run: {
    id: string
    startedAt: string
    trigger: BackupTrigger
    destination: string
  },
): void {
  db.prepare(
    `INSERT INTO backup_runs (id, started_at, trigger, destination, status)
     VALUES (?, ?, ?, ?, 'running')`,
  ).run(run.id, run.startedAt, run.trigger, run.destination)
}

function finishRun(
  db: Database,
  id: string,
  finishedAt: string,
  outcome: { ok: boolean; sizeBytes?: number | null; fileName?: string | null; error?: string },
): void {
  db.prepare(
    `UPDATE backup_runs
        SET finished_at = ?, status = ?, size_bytes = ?, file_name = ?, error = ?
      WHERE id = ?`,
  ).run(
    finishedAt,
    outcome.ok ? 'ok' : 'failed',
    outcome.sizeBytes ?? null,
    outcome.fileName ?? null,
    outcome.error ?? null,
    id,
  )
}

/**
 * Takes a consistent snapshot of the live database and writes it gzipped to `targetPath`.
 * VACUUM INTO produces a self-contained copy while the server keeps serving requests.
 */
export async function writeCompressedSnapshot(db: Database, targetPath: string): Promise<number> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const rawPath = `${targetPath}.tmp-${randomUUID()}.db`
  try {
    db.prepare('VACUUM INTO ?').run(rawPath)
    await pipeline(fs.createReadStream(rawPath), createGzip({ level: 9 }), fs.createWriteStream(targetPath))
  } finally {
    await fsp.rm(rawPath, { force: true })
  }
  return (await fsp.stat(targetPath)).size
}

async function uploadToS3(
  destination: S3BackupDestination,
  fileName: string,
  body: Buffer,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<void> {
  const key = `${destination.prefix}${fileName}`
  const url = new URL(
    `${destination.endpoint.replace(/\/+$/, '')}/${destination.bucket}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`,
  )
  const headers = signRequest({
    method: 'PUT',
    url,
    headers: { 'content-type': 'application/gzip' },
    payload: body,
    region: destination.region,
    accessKeyId: destination.accessKeyId,
    secretAccessKey: destination.secretAccessKey,
    now,
  })

  const response = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300)
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`)
  }
}

async function copyToFolder(destination: string, localPath: string, fileName: string): Promise<void> {
  await fsp.mkdir(destination, { recursive: true })
  await fsp.copyFile(localPath, path.join(destination, fileName))
}

/** Lists snapshots in the backup folder, oldest first. */
export async function listLocalSnapshots(
  backupsDir: string,
): Promise<{ fileName: string; trigger: string; stamp: string }[]> {
  let names: string[]
  try {
    names = await fsp.readdir(backupsDir)
  } catch {
    return []
  }
  return names
    .map((fileName) => ({ fileName, match: FILE_NAME_PATTERN.exec(fileName) }))
    .filter((entry): entry is { fileName: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ fileName, match }) => ({ fileName, stamp: match[1] as string, trigger: match[2] as string }))
    .sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0))
}

export async function pruneLocalSnapshots(
  backupsDir: string,
  keepRoutine: number,
  logger: Logger,
): Promise<void> {
  const all = await listLocalSnapshots(backupsDir)
  const isSafety = (trigger: string): boolean => (SAFETY_TRIGGERS as readonly string[]).includes(trigger)

  const routine = all.filter((entry) => !isSafety(entry.trigger))
  const safety = all.filter((entry) => isSafety(entry.trigger))
  const doomed = [
    ...routine.slice(0, Math.max(0, routine.length - keepRoutine)),
    ...safety.slice(0, Math.max(0, safety.length - SAFETY_SNAPSHOTS_TO_KEEP)),
  ]
  for (const entry of doomed) {
    await fsp.rm(path.join(backupsDir, entry.fileName), { force: true })
    logger.debug({ fileName: entry.fileName }, 'old local backup removed')
  }
}

let backupInProgress = false

/**
 * Snapshots the database locally, then copies the snapshot to every configured destination.
 * A failing destination never fails the local backup: the local copy is what matters most.
 */
export async function runBackup(deps: BackupDependencies, trigger: BackupTrigger): Promise<BackupResult> {
  const log = deps.logger.child({ component: 'backup' })
  if (backupInProgress) {
    log.warn({ trigger }, 'backup already running, skipping')
    return { ok: false, fileName: null, localPath: null, sizeBytes: null, destinations: [] }
  }
  backupInProgress = true

  const startedAt = deps.now().toISOString()
  const fileName = snapshotFileName(deps.now(), trigger)
  const localPath = path.join(deps.backupsDir, fileName)
  const localRunId = randomUUID()
  recordRun(deps.db, { id: localRunId, startedAt, trigger, destination: 'local' })

  try {
    let sizeBytes: number
    try {
      sizeBytes = await writeCompressedSnapshot(deps.db, localPath)
    } catch (error) {
      const message = (error as Error).message
      finishRun(deps.db, localRunId, deps.now().toISOString(), { ok: false, error: message })
      log.error({ err: error, trigger }, 'local backup failed')
      return {
        ok: false,
        fileName: null,
        localPath: null,
        sizeBytes: null,
        destinations: [{ destination: 'local', ok: false, error: message }],
      }
    }

    finishRun(deps.db, localRunId, deps.now().toISOString(), { ok: true, sizeBytes, fileName })
    log.info({ trigger, fileName, sizeBytes }, 'local backup created')

    const outcomes: DestinationOutcome[] = [{ destination: 'local', ok: true }]
    const body = deps.config.destinations.some((d) => d.type === 's3') ? await fsp.readFile(localPath) : null

    for (const destination of deps.config.destinations) {
      const label = describeDestination(destination)
      const runId = randomUUID()
      recordRun(deps.db, { id: runId, startedAt: deps.now().toISOString(), trigger, destination: label })
      try {
        if (destination.type === 'folder') {
          await copyToFolder(destination.path, localPath, fileName)
        } else {
          await uploadToS3(destination, fileName, body as Buffer, deps.now(), deps.fetchImpl ?? fetch)
        }
        finishRun(deps.db, runId, deps.now().toISOString(), { ok: true, sizeBytes, fileName })
        outcomes.push({ destination: label, ok: true })
        log.info({ destination: label, fileName }, 'backup copied')
      } catch (error) {
        const message = (error as Error).message
        finishRun(deps.db, runId, deps.now().toISOString(), { ok: false, error: message })
        outcomes.push({ destination: label, ok: false, error: message })
        log.error({ destination: label, err: error }, 'backup destination failed')
      }
    }

    await pruneLocalSnapshots(deps.backupsDir, deps.config.localRetention, log)

    return { ok: true, fileName, localPath, sizeBytes, destinations: outcomes }
  } finally {
    backupInProgress = false
  }
}

// ---------- scheduling ----------

const HOUR_MS = 60 * 60_000
export const BACKUP_MAX_AGE_MS = 24 * HOUR_MS
export const BACKUP_DIRTY_AGE_MS = 6 * HOUR_MS
export const BACKUP_STARTUP_DELAY_MS = 5 * 60_000

export interface BackupDecisionInput {
  now: Date
  /** Finish time of the newest successful local backup, if any. */
  lastOkAt: Date | null
  /** True when data was written since that backup. */
  dirty: boolean
  /** How long this server process has been running. */
  uptimeMs: number
}

/**
 * Backups follow events, not a clock: the shop's computer is often off at night, so a fixed
 * 02:00 job would simply never run (PLAN D-28).
 */
export function decideBackup(input: BackupDecisionInput): { run: boolean; reason: string } {
  if (input.uptimeMs < BACKUP_STARTUP_DELAY_MS) return { run: false, reason: 'warming up' }
  if (!input.lastOkAt) return { run: true, reason: 'no backup yet' }

  const age = input.now.getTime() - input.lastOkAt.getTime()
  if (age > BACKUP_MAX_AGE_MS) return { run: true, reason: 'last backup older than 24h' }
  if (input.dirty && age > BACKUP_DIRTY_AGE_MS) return { run: true, reason: 'data changed since last backup' }
  return { run: false, reason: 'up to date' }
}

export function lastSuccessfulLocalBackup(db: Database): Date | null {
  const row = db
    .prepare(
      `SELECT finished_at FROM backup_runs
        WHERE destination = 'local' AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
    )
    .get() as { finished_at: string } | undefined
  return row ? new Date(row.finished_at) : null
}

export interface BackupScheduler {
  /** Call after any successful write so the next check knows a new backup is worthwhile. */
  markDirty(): void
  stop(): void
}

export function startBackupScheduler(
  deps: BackupDependencies,
  options: { checkIntervalMs?: number } = {},
): BackupScheduler {
  const startedAt = deps.now().getTime()
  let dirty = false
  let ranBefore = false
  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    const decision = decideBackup({
      now: deps.now(),
      lastOkAt: lastSuccessfulLocalBackup(deps.db),
      dirty,
      uptimeMs: deps.now().getTime() - startedAt,
    })
    if (!decision.run) return

    running = true
    try {
      deps.logger.info({ component: 'backup', reason: decision.reason }, 'starting scheduled backup')
      const result = await runBackup(deps, ranBefore ? 'periodic' : 'startup')
      ranBefore = true
      if (result.ok) dirty = false
    } catch (error) {
      deps.logger.error({ component: 'backup', err: error }, 'scheduled backup crashed')
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), options.checkIntervalMs ?? 60_000)
  timer.unref()

  return {
    markDirty: () => {
      dirty = true
    },
    stop: () => clearInterval(timer),
  }
}

// ---------- health ----------

const WARNING_AFTER_MS = 48 * HOUR_MS

export interface BackupHealth {
  lastBackup: { at: string; status: 'ok' } | null
  warnings: string[]
}

/** What /api/health reports about backups: the newest good backup and anything that needs attention. */
export function backupHealth(db: Database, now: Date, hasCloudDestination: boolean): BackupHealth {
  const lastLocal = lastSuccessfulLocalBackup(db)
  const installedRow = db.prepare('SELECT MIN(created_at) AS at FROM users').get() as { at: string | null }
  const installedAt = installedRow.at ? new Date(installedRow.at) : null
  const warnings: string[] = []

  // A fresh install has had no chance to back up yet, so only warn once it is old enough.
  const oldEnough = installedAt !== null && now.getTime() - installedAt.getTime() > WARNING_AFTER_MS

  if (lastLocal) {
    if (now.getTime() - lastLocal.getTime() > WARNING_AFTER_MS) {
      warnings.push('Đã hơn 48 giờ chưa sao lưu dữ liệu thành công')
    }
  } else if (oldEnough) {
    warnings.push('Chưa có bản sao lưu nào')
  }

  if (hasCloudDestination && oldEnough) {
    const lastCloud = db
      .prepare(
        `SELECT finished_at FROM backup_runs
          WHERE destination LIKE 's3:%' AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
      )
      .get() as { finished_at: string } | undefined
    if (!lastCloud || now.getTime() - Date.parse(lastCloud.finished_at) > WARNING_AFTER_MS) {
      warnings.push('Đã hơn 48 giờ chưa sao lưu lên cloud')
    }
  }

  return {
    lastBackup: lastLocal ? { at: lastLocal.toISOString(), status: 'ok' } : null,
    warnings,
  }
}
