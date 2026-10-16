import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp, type BuildAppOptions } from '../../src/app.js'
import { openDatabase, type Database } from '../../src/db/client.js'
import { loadMigrationFiles, runMigrations } from '../../src/db/migrate.js'
import { createUser } from '../../src/modules/auth/service.js'
import { createCaptureLogger, type LogRecord } from './index.js'

export const TEST_PORT = 8686
export const ADMIN_USERNAME = 'admin'
export const ADMIN_PASSWORD = 'secret-pass'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../src/db/migrations', import.meta.url))

export interface ApiResponse<T = unknown> {
  status: number
  body: T
  headers: Record<string, unknown>
}

export interface TestApp {
  app: FastifyInstance
  db: Database
  logRecords: LogRecord[]
  /** Moves the app's clock; sessions and "today" follow it. */
  setNow(date: Date): void
  /** Requests made with the admin session cookie. */
  api: {
    get<T = any>(url: string): Promise<ApiResponse<T>>
    post<T = any>(url: string, body?: unknown): Promise<ApiResponse<T>>
    put<T = any>(url: string, body?: unknown): Promise<ApiResponse<T>>
    patch<T = any>(url: string, body?: unknown): Promise<ApiResponse<T>>
    delete<T = any>(url: string): Promise<ApiResponse<T>>
  }
  /** Raw request without any session, for testing authentication itself. */
  anonymous: {
    get<T = any>(url: string): Promise<ApiResponse<T>>
    post<T = any>(url: string, body?: unknown): Promise<ApiResponse<T>>
  }
  close(): Promise<void>
}

/** A fully migrated in-memory app with an admin user already logged in. */
export async function createTestApp(
  options: { now?: Date; backup?: (db: Database) => NonNullable<BuildAppOptions['backup']> } = {},
): Promise<TestApp> {
  const db = openDatabase(':memory:')
  runMigrations(db, loadMigrationFiles(MIGRATIONS_DIR))
  const capture = createCaptureLogger()

  let currentNow = options.now ?? new Date('2026-10-11T03:00:00Z')
  const app = await buildApp({
    port: TEST_PORT,
    db,
    logger: capture.logger,
    version: 'test',
    now: () => currentNow,
    ...(options.backup ? { backup: options.backup(db) } : {}),
  })

  await createUser(
    { db, logger: capture.logger, now: () => currentNow },
    { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  )

  const baseHeaders = { host: `localhost:${TEST_PORT}`, origin: `http://localhost:${TEST_PORT}` }

  const send = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    body: unknown,
    cookieHeader?: string,
  ): Promise<ApiResponse<T>> => {
    const response = await app.inject({
      method,
      url,
      headers: { ...baseHeaders, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    })
    let parsed: unknown = null
    try {
      parsed = response.json()
    } catch {
      parsed = response.body
    }
    return { status: response.statusCode, body: parsed as T, headers: response.headers }
  }

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: baseHeaders,
    payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  })
  const setCookie = loginResponse.headers['set-cookie']
  const cookieValue = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(';')[0]
  if (!cookieValue) throw new Error('test login did not return a session cookie')

  return {
    app,
    db,
    logRecords: capture.records,
    setNow: (date) => {
      currentNow = date
    },
    api: {
      get: (url) => send('GET', url, undefined, cookieValue),
      post: (url, body) => send('POST', url, body ?? {}, cookieValue),
      put: (url, body) => send('PUT', url, body, cookieValue),
      patch: (url, body) => send('PATCH', url, body, cookieValue),
      delete: (url) => send('DELETE', url, undefined, cookieValue),
    },
    anonymous: {
      get: (url) => send('GET', url, undefined),
      post: (url, body) => send('POST', url, body ?? {}),
    },
    close: async () => {
      await app.close()
      db.close()
    },
  }
}
