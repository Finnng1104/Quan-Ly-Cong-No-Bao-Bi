import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import type { Logger } from 'pino'
import type { BackupConfig, FolderBackupDestination } from '../../config/index.js'
import type { Database } from '../../db/client.js'
import { BACKUP_FILE_NAME_PATTERN } from './cloud.js'
import { createStores, type BackupStore } from './stores.js'

export type BackupTrigger = 'startup' | 'periodic' | 'pre-update' | 'pre-restore' | 'manual'

/** Snapshots taken for safety around risky operations are retained separately from routine ones. */
const SAFETY_TRIGGERS: readonly BackupTrigger[] = ['pre-update', 'pre-restore']
const SAFETY_SNAPSHOTS_TO_KEEP = 3

export interface DestinationOutcome {
  destination: string
  kind?: BackupStore['kind']
  ok: boolean
  /** The drive is not plugged in: normal for an occasional drive, retried as soon as it appears. */
  unavailable?: boolean
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
    .map((fileName) => ({ fileName, match: BACKUP_FILE_NAME_PATTERN.exec(fileName) }))
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

const storesOf = (deps: BackupDependencies): BackupStore[] =>
  createStores(deps.config, { fetchImpl: deps.fetchImpl ?? fetch, now: deps.now })

const DRIVE_UNPLUGGED_MESSAGE = 'Ổ sao lưu chưa được cắm'

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

    for (const store of storesOf(deps)) {
      if (!(await store.isAvailable())) {
        // Not an error worth recording: the copy is queued and goes over once the drive is back.
        outcomes.push({
          destination: store.label,
          kind: store.kind,
          ok: false,
          unavailable: true,
          error: DRIVE_UNPLUGGED_MESSAGE,
        })
        continue
      }
      const runId = randomUUID()
      recordRun(deps.db, { id: runId, startedAt: deps.now().toISOString(), trigger, destination: store.label })
      try {
        await store.put(fileName, localPath)
        finishRun(deps.db, runId, deps.now().toISOString(), { ok: true, sizeBytes, fileName })
        outcomes.push({ destination: store.label, kind: store.kind, ok: true })
        log.info({ destination: store.label, fileName }, 'backup copied')
      } catch (error) {
        const message = (error as Error).message
        finishRun(deps.db, runId, deps.now().toISOString(), { ok: false, error: message })
        outcomes.push({ destination: store.label, kind: store.kind, ok: false, error: message })
        log.error({ destination: store.label, err: error }, 'backup destination failed')
      }
    }

    await pruneLocalSnapshots(deps.backupsDir, deps.config.localRetention, log)

    return { ok: true, fileName, localPath, sizeBytes, destinations: outcomes }
  } finally {
    backupInProgress = false
  }
}

// ---------- catching up drives and online storage ----------

const NETWORK_RETRY_MS = 10 * 60_000
const SYNC_STARTUP_DELAY_MS = 30_000

export interface SyncOutcome {
  destination: string
  kind: BackupStore['kind']
  ok: boolean
  unavailable?: boolean
  copied: string[]
  pruned: string[]
  error?: string
}

let syncInProgress = false

/**
 * Brings every drive and online store in line with the local folder: copies snapshots they do not
 * have yet (the drive was unplugged, the shop was offline) and drops the oldest beyond the
 * retention limit. Being unplugged or offline is normal, so it is reported, never thrown.
 */
export async function syncDestinations(deps: BackupDependencies): Promise<SyncOutcome[]> {
  const stores = storesOf(deps)
  if (stores.length === 0 || syncInProgress) return []
  syncInProgress = true

  const log = deps.logger.child({ component: 'backup' })
  const outcomes: SyncOutcome[] = []
  try {
    for (const store of stores) {
      const outcome: SyncOutcome = {
        destination: store.label,
        kind: store.kind,
        ok: true,
        copied: [],
        pruned: [],
      }
      try {
        if (!(await store.isAvailable())) {
          outcome.ok = false
          outcome.unavailable = true
          outcomes.push(outcome)
          continue
        }

        const present = new Set((await store.list()).map((copy) => copy.fileName))
        const missing = (await listLocalSnapshots(deps.backupsDir)).filter(
          (entry) => !present.has(entry.fileName),
        )

        for (const entry of missing) {
          const runId = randomUUID()
          recordRun(deps.db, {
            id: runId,
            startedAt: deps.now().toISOString(),
            trigger: entry.trigger as BackupTrigger,
            destination: store.label,
          })
          try {
            await store.put(entry.fileName, path.join(deps.backupsDir, entry.fileName))
            const sizeBytes = (await fsp.stat(path.join(deps.backupsDir, entry.fileName))).size
            finishRun(deps.db, runId, deps.now().toISOString(), { ok: true, sizeBytes, fileName: entry.fileName })
            present.add(entry.fileName)
            outcome.copied.push(entry.fileName)
          } catch (error) {
            finishRun(deps.db, runId, deps.now().toISOString(), { ok: false, error: (error as Error).message })
            throw error
          }
        }

        const doomed = [...present].sort().slice(0, Math.max(0, present.size - deps.config.destinationRetention))
        for (const fileName of doomed) {
          await store.remove(fileName)
          outcome.pruned.push(fileName)
        }
        if (outcome.copied.length > 0 || outcome.pruned.length > 0) {
          log.info(
            { destination: store.label, copied: outcome.copied.length, pruned: outcome.pruned.length },
            'backup copies synced',
          )
        }
      } catch (error) {
        outcome.ok = false
        outcome.error = (error as Error).message
        log.warn({ destination: store.label, err: error }, 'backup sync failed, will retry')
      }
      outcomes.push(outcome)
    }
    return outcomes
  } finally {
    syncInProgress = false
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

/** Newest successful copy to destinations whose label starts with `prefix` ('folder:' or 's3:'). */
export function lastSuccessfulCopy(db: Database, prefix: 'folder:' | 's3:'): Date | null {
  const row = db
    .prepare(
      `SELECT finished_at FROM backup_runs
        WHERE destination LIKE ? AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`,
    )
    .get(`${prefix}%`) as { finished_at: string } | undefined
  return row ? new Date(row.finished_at) : null
}

export interface BackupScheduler {
  /** Call after any successful write so the next check knows a new backup is worthwhile. */
  markDirty(): void
  /** Tell the scheduler how a backup went, so copies that did not arrive get retried. */
  noteBackupResult(result: BackupResult): void
  /** Ask for a catch-up soon, e.g. right after a drive was chosen in Settings. */
  requestSync(): void
  stop(): void
}

export function startBackupScheduler(
  deps: BackupDependencies,
  options: { checkIntervalMs?: number; networkRetryMs?: number } = {},
): BackupScheduler {
  const startedAt = deps.now().getTime()
  const networkRetryMs = options.networkRetryMs ?? NETWORK_RETRY_MS
  let dirty = false
  let ranBefore = false
  let running = false
  // Starting up counts as "maybe behind": copies from an unplugged or offline stretch may be waiting.
  let syncDue = true
  let lastSyncAttemptAt = 0
  // A drive is checked on every tick (it is only a file-system check); the network waits longer.
  let retryDelayMs = 0

  const waitFor = (outcomes: { kind?: BackupStore['kind']; ok: boolean }[]): number =>
    outcomes.some((outcome) => !outcome.ok && outcome.kind === 's3') ? networkRetryMs : 0

  const noteBackupResult = (result: BackupResult): void => {
    if (!result.ok) return
    syncDue = true
    const anyMissing = result.destinations.some((destination) => !destination.ok && destination.kind)
    // After a success sync soon (to prune old copies); after a failure wait out the retry delay.
    lastSyncAttemptAt = anyMissing ? deps.now().getTime() : 0
    retryDelayMs = waitFor(result.destinations)
  }

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const now = deps.now()
      const decision = decideBackup({
        now,
        lastOkAt: lastSuccessfulLocalBackup(deps.db),
        dirty,
        uptimeMs: now.getTime() - startedAt,
      })
      if (decision.run) {
        deps.logger.info({ component: 'backup', reason: decision.reason }, 'starting scheduled backup')
        const result = await runBackup(deps, ranBefore ? 'periodic' : 'startup')
        ranBefore = true
        if (result.ok) dirty = false
        noteBackupResult(result)
      }

      const current = deps.now().getTime()
      const waitedLongEnough = current - lastSyncAttemptAt >= retryDelayMs
      if (syncDue && waitedLongEnough && current - startedAt >= SYNC_STARTUP_DELAY_MS) {
        lastSyncAttemptAt = current
        const outcomes = await syncDestinations(deps)
        syncDue = outcomes.some((outcome) => !outcome.ok)
        retryDelayMs = waitFor(outcomes)
      }
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
    noteBackupResult,
    requestSync: () => {
      syncDue = true
      lastSyncAttemptAt = 0
      retryDelayMs = 0
    },
    stop: () => clearInterval(timer),
  }
}

// ---------- health ----------

const WARNING_AFTER_MS = 48 * HOUR_MS
// A drive used now and then is only worth a reminder when it has really been neglected.
const OCCASIONAL_DRIVE_WARNING_AFTER_MS = 14 * 24 * HOUR_MS

export interface BackupHealth {
  lastBackup: { at: string; status: 'ok' } | null
  warnings: string[]
}

/** What /api/health reports about backups: the newest good backup and anything that needs attention. */
export function backupHealth(
  db: Database,
  now: Date,
  hasCloudDestination: boolean,
  drives: readonly FolderBackupDestination[] = [],
): BackupHealth {
  const lastLocal = lastSuccessfulLocalBackup(db)
  const installedRow = db.prepare('SELECT MIN(created_at) AS at FROM users').get() as { at: string | null }
  const installedAt = installedRow.at ? new Date(installedRow.at) : null
  const warnings: string[] = []
  const installedFor = (ms: number): boolean =>
    installedAt !== null && now.getTime() - installedAt.getTime() > ms

  // A fresh install has had no chance to back up yet, so only warn once it is old enough.
  const oldEnough = installedFor(WARNING_AFTER_MS)

  if (lastLocal) {
    if (now.getTime() - lastLocal.getTime() > WARNING_AFTER_MS) {
      warnings.push('Đã hơn 48 giờ chưa sao lưu dữ liệu thành công')
    }
  } else if (oldEnough) {
    warnings.push('Chưa có bản sao lưu nào')
  }

  if (hasCloudDestination && oldEnough) {
    const lastCloud = lastSuccessfulCopy(db, 's3:')
    if (!lastCloud || now.getTime() - lastCloud.getTime() > WARNING_AFTER_MS) {
      warnings.push('Đã hơn 48 giờ chưa sao lưu lên cloud')
    }
  }

  if (drives.length > 0) {
    const occasional = drives.every((drive) => drive.mode === 'occasional')
    const limit = occasional ? OCCASIONAL_DRIVE_WARNING_AFTER_MS : WARNING_AFTER_MS
    if (installedFor(limit)) {
      const lastDrive = lastSuccessfulCopy(db, 'folder:')
      if (!lastDrive || now.getTime() - lastDrive.getTime() > limit) {
        warnings.push(
          occasional
            ? 'Đã hơn 14 ngày chưa sao lưu ra ổ cứng ngoài. Hãy cắm ổ vào máy.'
            : 'Đã hơn 48 giờ chưa sao lưu ra ổ cứng ngoài. Hãy kiểm tra ổ đã được cắm chưa.',
        )
      }
    }
  }

  return {
    lastBackup: lastLocal ? { at: lastLocal.toISOString(), status: 'ok' } : null,
    warnings,
  }
}
