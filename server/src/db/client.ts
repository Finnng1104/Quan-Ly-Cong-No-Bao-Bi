import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type BetterSqlite3 from 'better-sqlite3'

export type Database = BetterSqlite3.Database

/** The native addon is missing or was built for another Node ABI / OS / CPU. */
export class NativeModuleLoadError extends Error {
  constructor(cause: unknown) {
    super(
      'Cannot load the SQLite native module (better-sqlite3). ' +
        'It was probably built for a different Node.js version or platform.',
      { cause },
    )
    this.name = 'NativeModuleLoadError'
  }
}

const require = createRequire(import.meta.url)

// Loaded lazily and synchronously so a broken addon surfaces as a typed error we can map
// to a dedicated exit code, instead of an opaque crash at import time.
function loadDriver(): typeof BetterSqlite3 {
  try {
    return require('better-sqlite3') as typeof BetterSqlite3
  } catch (cause) {
    throw new NativeModuleLoadError(cause)
  }
}

export function openDatabase(dbPath: string): Database {
  const Driver = loadDriver()
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new Driver(dbPath)

  // WAL + FULL sync: a power cut may lose the transaction in flight but never corrupts the
  // ledger. At one shop's write volume the speed difference versus NORMAL is negligible.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export interface IntegrityResult {
  ok: boolean
  messages: string[]
}

/** Cheaper than integrity_check, yet catches structural corruption. Run once at startup. */
export function quickCheck(db: Database): IntegrityResult {
  const rows = db.pragma('quick_check') as { quick_check: string }[]
  const messages = rows.map((row) => row.quick_check)
  return { ok: messages.length === 1 && messages[0] === 'ok', messages }
}

export function canQueryDatabase(db: Database): boolean {
  try {
    db.prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}
