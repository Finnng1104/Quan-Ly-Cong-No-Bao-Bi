import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  TEST_PORT,
  createTestApp,
  type TestApp,
} from '../../../test/helpers/app.js'
import { hashPassword, verifyPassword } from '../../shared/password.js'

describe('auth', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp()
  })

  afterEach(async () => {
    await t.close()
  })

  const login = async (username: string, password: string) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: `localhost:${TEST_PORT}`, origin: `http://localhost:${TEST_PORT}` },
      payload: { username, password },
    })

  const cookieOf = (response: { headers: Record<string, unknown> }): string => {
    const header = response.headers['set-cookie']
    const raw = (Array.isArray(header) ? header[0] : header) as string
    return raw.split(';')[0] as string
  }

  describe('password hashing', () => {
    it('stores parameters and a random salt, and verifies correctly', async () => {
      const first = await hashPassword('mật-khẩu-123')
      const second = await hashPassword('mật-khẩu-123')

      expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
      expect(first).not.toBe(second)
      expect(await verifyPassword('mật-khẩu-123', first)).toBe(true)
      expect(await verifyPassword('mật-khẩu-124', first)).toBe(false)
      expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    })
  })

  describe('login', () => {
    it('sets an httpOnly session cookie and the session then identifies the user', async () => {
      const response = await login(ADMIN_USERNAME, ADMIN_PASSWORD)

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ username: ADMIN_USERNAME, role: 'owner' })
      const setCookie = String(response.headers['set-cookie'])
      expect(setCookie).toMatch(/^qlcn_sid=/)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')

      const me = await t.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { host: `localhost:${TEST_PORT}`, cookie: cookieOf(response) },
      })
      expect(me.json()).toEqual({ username: ADMIN_USERNAME, role: 'owner' })
    })

    it('is case-insensitive on the username', async () => {
      const response = await login('ADMIN', ADMIN_PASSWORD)

      expect(response.statusCode).toBe(200)
    })

    it('never stores the session token itself, only its hash', async () => {
      const response = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
      const token = cookieOf(response).split('=')[1] as string

      const rows = t.db.prepare('SELECT id FROM sessions').all() as { id: string }[]

      expect(rows.some((row) => row.id === token)).toBe(false)
      expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.id))).toBe(true)
    })

    it('gives the same answer for a wrong password and an unknown user', async () => {
      const wrongPassword = await login(ADMIN_USERNAME, 'nope-nope')
      const unknownUser = await login('ghost', 'nope-nope')

      expect(wrongPassword.statusCode).toBe(401)
      expect(unknownUser.statusCode).toBe(401)
      expect(wrongPassword.json()).toEqual(unknownUser.json())
    })

    it('locks the account after 5 wrong passwords, even for the right one, then unlocks', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await login(ADMIN_USERNAME, 'wrong-password')).statusCode).toBe(401)
      }

      const locked = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
      expect(locked.statusCode).toBe(429)
      expect(locked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })

      t.setNow(new Date('2026-10-11T03:06:00Z')) // 6 minutes later, lock was 5
      expect((await login(ADMIN_USERNAME, ADMIN_PASSWORD)).statusCode).toBe(200)
    })

    it('rate-limits guesses of unknown usernames too', async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        await login('nobody-here', 'whatever')
      }

      const response = await login('nobody-here', 'whatever')

      expect(response.statusCode).toBe(429)
    })

    it('validates the body', async () => {
      const response = await t.anonymous.post('/api/auth/login', { username: '', password: '' })

      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    })
  })

  describe('sessions', () => {
    it('rejects protected routes without a session', async () => {
      const response = await t.anonymous.get('/api/customers')

      expect(response.status).toBe(401)
    })

    it('ends the session on logout', async () => {
      const response = await login(ADMIN_USERNAME, ADMIN_PASSWORD)
      const headers = { host: `localhost:${TEST_PORT}`, origin: `http://localhost:${TEST_PORT}`, cookie: cookieOf(response) }

      const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} })
      expect(out.statusCode).toBe(200)

      const after = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers })
      expect(after.statusCode).toBe(401)
    })

    it('expires after 30 days', async () => {
      expect((await t.api.get('/api/auth/me')).status).toBe(200)

      t.setNow(new Date('2026-11-12T03:00:00Z')) // 32 days later

      expect((await t.api.get('/api/auth/me')).status).toBe(401)
    })

    it('is extended when used after a while', async () => {
      t.setNow(new Date('2026-11-05T03:00:00Z')) // day 25
      expect((await t.api.get('/api/auth/me')).status).toBe(200)

      t.setNow(new Date('2026-11-20T03:00:00Z')) // day 40, but renewed on day 25

      expect((await t.api.get('/api/auth/me')).status).toBe(200)
    })
  })

  describe('change password', () => {
    it('requires the old password', async () => {
      const response = await t.api.post('/api/auth/change-password', {
        oldPassword: 'not-it',
        newPassword: 'brand-new-pass',
      })

      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({ error: { fields: { oldPassword: expect.any(String) } } })
    })

    it('enforces the minimum length of 4', async () => {
      const response = await t.api.post('/api/auth/change-password', {
        oldPassword: ADMIN_PASSWORD,
        newPassword: 'abc',
      })

      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({ error: { fields: { newPassword: expect.any(String) } } })
    })

    it('switches the password and revokes other sessions but keeps the current one', async () => {
      const otherDevice = await login(ADMIN_USERNAME, ADMIN_PASSWORD)

      const response = await t.api.post('/api/auth/change-password', {
        oldPassword: ADMIN_PASSWORD,
        newPassword: 'brand-new-pass',
      })
      expect(response.status).toBe(200)

      expect((await t.api.get('/api/auth/me')).status).toBe(200)
      const revoked = await t.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { host: `localhost:${TEST_PORT}`, cookie: cookieOf(otherDevice) },
      })
      expect(revoked.statusCode).toBe(401)

      expect((await login(ADMIN_USERNAME, ADMIN_PASSWORD)).statusCode).toBe(401)
      expect((await login(ADMIN_USERNAME, 'brand-new-pass')).statusCode).toBe(200)
    })
  })
})
