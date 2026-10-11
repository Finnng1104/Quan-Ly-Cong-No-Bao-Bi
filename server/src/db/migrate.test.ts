import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTempDir, removeDir } from '../../test/helpers/index.js'
import { openDatabase, type Database } from './client.js'
import { getSchemaVersion, loadMigrationFiles, MigrationError, runMigrations } from './migrate.js'

describe('migrations', () => {
  let dir: string
  let db: Database

  const writeMigration = (fileName: string, sql: string): void => {
    fs.writeFileSync(path.join(dir, fileName), sql)
  }
  const tableNames = (): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (row) => row.name,
    )

  beforeEach(() => {
    dir = makeTempDir()
    db = openDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
    removeDir(dir)
  })

  it('applies pending files in order and records them', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    writeMigration('0002_create_b.sql', 'CREATE TABLE b (id INTEGER);')

    const result = runMigrations(db, loadMigrationFiles(dir))

    expect(result).toEqual({ appliedVersions: [1, 2], schemaVersion: 2 })
    expect(tableNames()).toEqual(expect.arrayContaining(['a', 'b', 'schema_migrations']))
  })

  it('is idempotent: a second run applies nothing', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    runMigrations(db, loadMigrationFiles(dir))

    const second = runMigrations(db, loadMigrationFiles(dir))

    expect(second).toEqual({ appliedVersions: [], schemaVersion: 1 })
  })

  it('reports schema version 0 for a database that was never migrated', () => {
    expect(getSchemaVersion(db)).toBe(0)
  })

  it('rolls back a failing migration and keeps earlier ones', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    writeMigration('0002_broken.sql', 'CREATE TABLE b (id INTEGER); INSERT INTO missing_table VALUES (1);')

    expect(() => runMigrations(db, loadMigrationFiles(dir))).toThrowError(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    )

    expect(getSchemaVersion(db)).toBe(1)
    // Table b was created before the failing statement; the transaction must have undone it.
    expect(tableNames()).not.toContain('b')
  })

  it('refuses to run when an applied migration file was edited', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    runMigrations(db, loadMigrationFiles(dir))

    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER, extra TEXT);')

    expect(() => runMigrations(db, loadMigrationFiles(dir))).toThrowError(
      expect.objectContaining({ code: 'CHECKSUM_MISMATCH' }),
    )
  })

  it('refuses to start when the database is newer than the code', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    writeMigration('0002_create_b.sql', 'CREATE TABLE b (id INTEGER);')
    runMigrations(db, loadMigrationFiles(dir))

    fs.rmSync(path.join(dir, '0002_create_b.sql'))

    expect(() => runMigrations(db, loadMigrationFiles(dir))).toThrowError(
      expect.objectContaining({ code: 'DB_NEWER_THAN_CODE' }),
    )
  })

  it('treats CRLF and LF checkouts of the same file as identical', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (\n  id INTEGER\n);\n')
    runMigrations(db, loadMigrationFiles(dir))

    writeMigration('0001_create_a.sql', 'CREATE TABLE a (\r\n  id INTEGER\r\n);\r\n')

    expect(() => runMigrations(db, loadMigrationFiles(dir))).not.toThrow()
  })

  it('rejects gaps in numbering and badly named files', () => {
    writeMigration('0001_create_a.sql', 'CREATE TABLE a (id INTEGER);')
    writeMigration('0003_create_c.sql', 'CREATE TABLE c (id INTEGER);')
    expect(() => loadMigrationFiles(dir)).toThrowError(MigrationError)

    removeDir(dir)
    dir = makeTempDir()
    writeMigration('0001_Bad-Name.sql', 'SELECT 1;')
    expect(() => loadMigrationFiles(dir)).toThrowError(
      expect.objectContaining({ code: 'INVALID_FILES' }),
    )
  })

  it('ignores non-sql files such as .gitkeep', () => {
    fs.writeFileSync(path.join(dir, '.gitkeep'), '')

    expect(loadMigrationFiles(dir)).toEqual([])
  })
})
