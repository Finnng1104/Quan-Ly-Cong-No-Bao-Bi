import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'
import { createWorld } from '../../../test/helpers/world.js'
import { makeTempDir, removeDir } from '../../../test/helpers/index.js'
import { loadConfig } from '../../config/index.js'
import { openDatabase } from '../../db/client.js'
import { loadMigrationFiles, runMigrations } from '../../db/migrate.js'
import { buildDiagnostics, writeDiagnosticsFile } from './diagnostics.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url))

describe('POST /api/client-log', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp()
  })

  afterEach(async () => {
    await t.close()
  })

  it('writes browser errors next to the server log, tagged as web', async () => {
    const response = await t.api.post('/api/client-log', {
      level: 'error',
      message: 'TypeError: x is undefined',
      stack: 'at OrderFormPage.jsx:42',
      url: 'http://localhost:8686/don-moi',
      userAgent: 'Chrome',
    })

    expect(response.status).toBe(200)
    const record = t.logRecords.find((r) => r.component === 'web')
    expect(record).toMatchObject({
      level: 'error',
      msg: 'TypeError: x is undefined',
      stack: 'at OrderFormPage.jsx:42',
      url: 'http://localhost:8686/don-moi',
    })
  })

  it('requires a session and validates the report', async () => {
    expect((await t.anonymous.post('/api/client-log', { message: 'x' })).status).toBe(401)
    expect((await t.api.post('/api/client-log', { message: 'x'.repeat(5000) })).status).toBe(400)
    expect((await t.api.post('/api/client-log', { level: 'debug', message: 'x' })).status).toBe(400)
  })

  it('accepts at most 30 reports a minute, so a broken page cannot flood the log', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 35; i++) {
      statuses.push((await t.api.post('/api/client-log', { message: `error ${i}` })).status)
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(30)
    expect(statuses.slice(30)).toEqual([429, 429, 429, 429, 429])
  })
})

describe('GET /api/health', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp({ now: new Date('2026-10-11T03:00:00Z') })
  })

  afterEach(async () => {
    await t.close()
  })

  it('turns to warning once an install goes two days without a backup', async () => {
    expect((await t.anonymous.get('/api/health')).body.status).toBe('ok')

    t.setNow(new Date('2026-10-14T03:00:00Z'))
    const stale = (await t.anonymous.get('/api/health')).body

    expect(stale.status).toBe('warning')
    expect(stale.warnings).toEqual(['Chưa có bản sao lưu nào'])
  })
})

describe('diagnostics file', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => removeDir(dir))

  it('contains what support needs but no business data, and masks credentials', async () => {
    const t = await createTestApp()
    await createWorld(t) // customers "Thanh Nhi", "Ông A" with phones and an opening debt of 59356
    await t.api.post('/api/payments', {
      customerId: (await t.api.get('/api/customers')).body.items[0].id,
      date: '2026-10-09',
      amount: 987654,
      note: 'ghi chú bí mật',
    })

    // Put that same database on disk, with a log file and a cloud destination with secrets.
    const dataDir = path.join(dir, 'data')
    fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true })
    fs.mkdirSync(path.join(dataDir, 'data'), { recursive: true })
    const dbPath = path.join(dataDir, 'data', 'app.db')
    t.db.prepare('VACUUM INTO ?').run(dbPath)
    await t.close()

    fs.writeFileSync(path.join(dataDir, 'logs', 'app.2026-10-11.1.log'), '{"msg":"server started"}\n')
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({
        backup: {
          destinations: [
            {
              type: 's3',
              endpoint: 'https://acct.r2.cloudflarestorage.com',
              bucket: 'shop',
              accessKeyId: 'AKIA-VERY-SECRET',
              secretAccessKey: 'super-secret-access-key',
            },
          ],
        },
      }),
    )

    const config = loadConfig({ flags: { dataDir }, env: {} })
    const now = new Date('2026-10-11T03:00:00Z')
    const report = await buildDiagnostics({ config, version: '1.0.0', now })
    const file = await writeDiagnosticsFile(report, path.join(dataDir, 'diagnostics'), now)
    const text = gunzipSync(fs.readFileSync(file)).toString('utf8')

    // useful
    expect(text).toContain('"version": "1.0.0"')
    expect(text).toContain('"schemaVersion": 2')
    expect(text).toContain('"quickCheck": "ok"')
    expect(text).toContain('server started')
    expect(text).toContain('"bucket": "shop"')
    // private
    for (const secret of [
      'Thanh Nhi',
      'Ông A',
      '0901234001',
      '987654',
      '59356',
      'ghi chú bí mật',
      'AKIA-VERY-SECRET',
      'super-secret-access-key',
    ]) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('still produces a report when the database is missing', async () => {
    const dataDir = path.join(dir, 'empty')
    const config = loadConfig({ flags: { dataDir }, env: {} })

    const report = await buildDiagnostics({ config, version: '1.0.0', now: new Date() })

    expect((report['database'] as Record<string, unknown>)['error']).toBeTruthy()
  })

  it('can read a database that is only migrated, without touching it', () => {
    const dbPath = path.join(dir, 'app.db')
    const db = openDatabase(dbPath)
    runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
    db.close()

    expect(fs.existsSync(dbPath)).toBe(true)
  })
})
