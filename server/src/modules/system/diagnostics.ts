import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { AppConfig } from '../../config/index.js'
import { openDatabase, quickCheck } from '../../db/client.js'
import { getSchemaVersion } from '../../db/migrate.js'
import { listLocalSnapshots } from '../backup/service.js'

const MAX_LOG_FILES = 7
const MAX_LOG_BYTES_PER_FILE = 256 * 1024
const RECENT_BACKUP_RUNS = 20

export interface DiagnosticsInput {
  config: AppConfig
  version: string
  now: Date
}

/**
 * Everything support needs to understand a problem, and nothing about the shop's business:
 * no customers, amounts or documents. Credentials in the configuration are masked.
 */
export async function buildDiagnostics(input: DiagnosticsInput): Promise<Record<string, unknown>> {
  const { config } = input

  const database: Record<string, unknown> = { path: config.dbPath }
  try {
    const stat = await fsp.stat(config.dbPath)
    database['sizeBytes'] = stat.size
    const db = openDatabase(config.dbPath)
    try {
      const check = quickCheck(db)
      database['quickCheck'] = check.ok ? 'ok' : check.messages.slice(0, 5)
      database['schemaVersion'] = getSchemaVersion(db)
      database['recentBackupRuns'] = db
        .prepare(
          `SELECT started_at, finished_at, trigger, destination, status, size_bytes, file_name, error
             FROM backup_runs ORDER BY started_at DESC LIMIT ?`,
        )
        .all(RECENT_BACKUP_RUNS)
    } finally {
      db.close()
    }
  } catch (error) {
    database['error'] = (error as Error).message
  }

  const snapshots = await listLocalSnapshots(config.backupsDir)
  const snapshotSizes = await Promise.all(
    snapshots.map(async (entry) => ({
      fileName: entry.fileName,
      sizeBytes: (await fsp.stat(path.join(config.backupsDir, entry.fileName))).size,
    })),
  )

  return {
    generatedAt: input.now.toISOString(),
    version: input.version,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    },
    config: {
      port: config.port,
      logLevel: config.logLevel,
      dataDir: config.dataDir,
      backup: {
        localRetention: config.backup.localRetention,
        destinations: config.backup.destinations.map((destination) =>
          destination.type === 'folder'
            ? { type: 'folder', path: destination.path }
            : {
                type: 's3',
                endpoint: destination.endpoint,
                bucket: destination.bucket,
                region: destination.region,
                prefix: destination.prefix,
                accessKeyId: '***',
                secretAccessKey: '***',
              },
        ),
      },
    },
    database,
    localBackups: snapshotSizes,
    logs: await readRecentLogs(config.logsDir),
  }
}

async function readRecentLogs(logsDir: string): Promise<{ name: string; text: string }[]> {
  let names: string[]
  try {
    names = (await fsp.readdir(logsDir)).filter((name) => name.endsWith('.log')).sort().reverse()
  } catch {
    return []
  }

  const logs: { name: string; text: string }[] = []
  for (const name of names.slice(0, MAX_LOG_FILES)) {
    const buffer = await fsp.readFile(path.join(logsDir, name))
    const tail = buffer.length > MAX_LOG_BYTES_PER_FILE ? buffer.subarray(buffer.length - MAX_LOG_BYTES_PER_FILE) : buffer
    logs.push({ name, text: tail.toString('utf8') })
  }
  return logs
}

/** Writes the report as one gzipped JSON file the customer can send over Zalo/email. */
export async function writeDiagnosticsFile(
  report: Record<string, unknown>,
  directory: string,
  now: Date,
): Promise<string> {
  await fsp.mkdir(directory, { recursive: true })
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')
  const filePath = path.join(directory, `qlcn-diagnostics-${stamp}.json.gz`)
  await fsp.writeFile(filePath, gzipSync(JSON.stringify(report, null, 2)))
  return filePath
}
