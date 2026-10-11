import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from './client.js'

export type MigrationErrorCode =
  | 'INVALID_FILES'
  | 'CHECKSUM_MISMATCH'
  | 'DB_NEWER_THAN_CODE'
  | 'MIGRATION_FAILED'

export class MigrationError extends Error {
  readonly code: MigrationErrorCode

  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MigrationError'
    this.code = code
  }
}

export interface MigrationFile {
  version: number
  name: string
  sql: string
  checksum: string
}

export interface MigrationResult {
  appliedVersions: number[]
  schemaVersion: number
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/

// Git on Windows may rewrite line endings (autocrlf). Hash a normalised form so the same
// migration never looks "edited" just because it was checked out on another OS.
function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

export function loadMigrationFiles(dir: string): MigrationFile[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch (cause) {
    throw new MigrationError('INVALID_FILES', `Cannot read migrations directory: ${dir}`, { cause })
  }

  const files: MigrationFile[] = []
  for (const entry of entries.filter((name) => name.endsWith('.sql')).sort()) {
    const match = FILE_PATTERN.exec(entry)
    if (!match) {
      throw new MigrationError(
        'INVALID_FILES',
        `Migration file "${entry}" must be named NNNN_description.sql (lowercase, digits, underscores)`,
      )
    }
    const sql = fs.readFileSync(path.join(dir, entry), 'utf8')
    files.push({
      version: Number(match[1]),
      name: match[2] as string,
      sql,
      checksum: checksumOf(sql),
    })
  }

  files.forEach((file, index) => {
    if (file.version !== index + 1) {
      throw new MigrationError(
        'INVALID_FILES',
        `Migration versions must be contiguous from 0001; found ${String(file.version).padStart(4, '0')} at position ${index + 1}`,
      )
    }
  })
  return files
}

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

/** Highest applied migration, or 0 for a database that was never migrated. */
export function getSchemaVersion(db: Database): number {
  const table = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  if (!table) return 0
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  return row.version ?? 0
}

export function runMigrations(db: Database, files: MigrationFile[]): MigrationResult {
  ensureMigrationsTable(db)

  const applied = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as { version: number; name: string; checksum: string }[]

  // A newer app wrote this database; running older code against it could silently misread data.
  const newest = applied.at(-1)
  if (newest && newest.version > files.length) {
    throw new MigrationError(
      'DB_NEWER_THAN_CODE',
      `Database schema is at version ${newest.version} but this build only knows up to ${files.length}. ` +
        'Refusing to start; install the matching (or newer) version.',
    )
  }

  for (const row of applied) {
    const file = files[row.version - 1]
    if (!file || file.name !== row.name || file.checksum !== row.checksum) {
      throw new MigrationError(
        'CHECKSUM_MISMATCH',
        `Migration ${String(row.version).padStart(4, '0')}_${row.name} was edited after it was applied. ` +
          'Applied migrations are immutable; add a new migration instead.',
      )
    }
  }

  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  )
  const appliedVersions: number[] = []

  for (const file of files.slice(applied.length)) {
    const apply = db.transaction(() => {
      db.exec(file.sql)
      insert.run(file.version, file.name, file.checksum, new Date().toISOString())
    })
    try {
      // IMMEDIATE takes the write lock up front, so two processes cannot both apply the same migration.
      apply.immediate()
    } catch (cause) {
      throw new MigrationError(
        'MIGRATION_FAILED',
        `Migration ${String(file.version).padStart(4, '0')}_${file.name} failed: ${(cause as Error).message}`,
        { cause },
      )
    }
    appliedVersions.push(file.version)
  }

  return { appliedVersions, schemaVersion: getSchemaVersion(db) }
}
