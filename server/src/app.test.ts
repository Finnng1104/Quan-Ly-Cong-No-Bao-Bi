import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCaptureLogger, type LogRecord } from '../test/helpers/index.js'
import { buildApp } from './app.js'
import { fileURLToPath } from 'node:url'
import { openDatabase, type Database } from './db/client.js'
import { loadMigrationFiles, runMigrations } from './db/migrate.js'
import { createUser } from './modules/auth/service.js'

const PORT = 8686
const OWN_HOST = `localhost:${PORT}`
const OWN_ORIGIN = `http://localhost:${PORT}`

describe('http app', () => {
  let app: FastifyInstance
  let db: Database
  let logRecords: LogRecord[]

  beforeEach(async () => {
    db = openDatabase(':memory:')
    runMigrations(db, loadMigrationFiles(fileURLToPath(new URL('./db/migrations', import.meta.url))))
    const capture = createCaptureLogger()
    logRecords = capture.records
    app = await buildApp({ port: PORT, db, logger: capture.logger, version: '1.2.3' })
  })

  afterEach(async () => {
    await app.close()
    db.close()
  })

  describe('GET /api/health', () => {
    it('reports version, schema version and database state', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host: OWN_HOST } })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        status: 'ok',
        version: '1.2.3',
        schemaVersion: 1,
        db: { ok: true },
        lastBackup: null,
        warnings: [],
      })
    })

    it('answers 503 when the database is unusable, so scripts can rely on curl -f', async () => {
      db.close()

      const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host: OWN_HOST } })

      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ status: 'error', db: { ok: false } })
    })
  })

  describe('request guard', () => {
    it('accepts both loopback spellings of our own host', async () => {
      for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `LOCALHOST:${PORT}`]) {
        const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host } })
        expect(response.statusCode, host).toBe(200)
      }
    })

    it('rejects a foreign Host header (DNS rebinding)', async () => {
      for (const host of ['evil.example.com', `localhost:${PORT + 1}`, 'localhost', '']) {
        const response = await app.inject({ method: 'GET', url: '/api/health', headers: { host } })
        expect(response.statusCode, host).toBe(403)
        expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
      }
    })

    it('rejects writes without an Origin, or with an origin on another port', async () => {
      const base = { method: 'POST', url: '/api/anything', payload: {} } as const

      const missing = await app.inject({ ...base, headers: { host: OWN_HOST } })
      const wrongPort = await app.inject({
        ...base,
        headers: { host: OWN_HOST, origin: `http://localhost:${PORT + 1}` },
      })
      const foreign = await app.inject({
        ...base,
        headers: { host: OWN_HOST, origin: 'https://evil.example.com' },
      })

      expect([missing.statusCode, wrongPort.statusCode, foreign.statusCode]).toEqual([403, 403, 403])
    })

    // These requests pass the guard and are then stopped by authentication (401), which proves
    // the guard let them through to the next layer.
    it('lets a write with our own Origin through to authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/anything',
        headers: { host: OWN_HOST, origin: OWN_ORIGIN },
        payload: {},
      })

      expect(response.statusCode).toBe(401)
    })

    it('does not require a content type for body-less writes', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/anything',
        headers: { host: OWN_HOST, origin: OWN_ORIGIN },
      })

      expect(response.statusCode).toBe(401)
    })

    it('rejects non-JSON bodies on writes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/anything',
        headers: { host: OWN_HOST, origin: OWN_ORIGIN, 'content-type': 'text/plain' },
        payload: 'amount=1',
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    })
  })

  describe('errors and request ids', () => {
    it('returns the standard error body for unauthenticated requests', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/nope', headers: { host: OWN_HOST } })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập' },
      })
    })

    it('echoes a well-formed x-request-id and replaces a suspicious one', async () => {
      const good = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: OWN_HOST, 'x-request-id': 'req-abc_123' },
      })
      const bad = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: OWN_HOST, 'x-request-id': 'has spaces & "quotes"' },
      })

      expect(good.headers['x-request-id']).toBe('req-abc_123')
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('tags every log line of a request with its request id, so a bug report can be traced', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: OWN_HOST, 'x-request-id': 'trace-me' },
      })

      expect(response.statusCode).toBe(200)
      const tagged = logRecords.filter((record) => record.requestId === 'trace-me')
      expect(tagged.map((record) => record.msg)).toEqual(['incoming request', 'request completed'])
    })
  })

  describe('hosted online', () => {
    const SITE = 'https://qlcn.vercel.app'
    const BACKEND = 'https://qlcn-api.example.com'
    let hostedApp: FastifyInstance

    beforeEach(async () => {
      const capture = createCaptureLogger()
      hostedApp = await buildApp({
        port: PORT,
        db,
        logger: capture.logger,
        version: '1.2.3',
        publicOrigins: [SITE, BACKEND],
      })
      await createUser(
        { db, logger: capture.logger, now: () => new Date() },
        { username: 'chu', password: 'mat-khau-dai' },
      )
    })

    afterEach(async () => {
      await hostedApp.close()
    })

    const login = (headers: Record<string, string>) =>
      hostedApp.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers,
        payload: { username: 'chu', password: 'mat-khau-dai' },
      })

    it('accepts the site forwarding /api to the backend, with a Secure session cookie', async () => {
      // Vercel's rewrite may present either address as Host; the browser sends the site as Origin.
      for (const host of ['qlcn-api.example.com', 'qlcn.vercel.app']) {
        const response = await login({ host, origin: SITE })
        expect(response.statusCode, host).toBe(200)
        expect(String(response.headers['set-cookie'])).toContain('Secure')
      }
    })

    it('still rejects other sites and plain http', async () => {
      const foreign = await login({ host: 'qlcn-api.example.com', origin: 'https://evil.example.com' })
      const plainHttp = await login({ host: 'qlcn-api.example.com', origin: 'http://qlcn.vercel.app' })
      const unknownHost = await hostedApp.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'evil.example.com' },
      })

      expect([foreign.statusCode, plainHttp.statusCode, unknownHost.statusCode]).toEqual([403, 403, 403])
    })
  })
})
