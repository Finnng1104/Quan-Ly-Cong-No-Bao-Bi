import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../../shared/password.js'
import type { AuthenticatedUser } from '../../shared/policy.js'

export const SESSION_COOKIE = 'qlcn_sid'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Rewriting the session row on every request would turn every read into a write.
const SESSION_REFRESH_AFTER_MS = 60 * 60 * 1000
const LOCK_AFTER_FAILURES = 5
const MAX_LOCK_MINUTES = 60

interface UserRow {
  id: string
  branch_id: string | null
  username: string
  password_hash: string
  role: string
  is_active: number
  failed_logins: number
  locked_until: string | null
}

interface SessionRow {
  id: string
  expires_at: string
  last_seen_at: string
  user_id: string
}

function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return { id: row.id, username: row.username, role: row.role, branchId: row.branch_id }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 5 failures lock for 5 minutes, 10 for 10, 15 for 20... capped at an hour. */
function lockMinutesFor(failures: number): number {
  const steps = Math.floor(failures / LOCK_AFTER_FAILURES)
  return Math.min(MAX_LOCK_MINUTES, LOCK_AFTER_FAILURES * 2 ** (steps - 1))
}

// Failures for usernames that do not exist cannot live in `users`; keeping them in memory means
// guessing names is rate-limited too, without revealing which names exist.
const unknownUserFailures = new Map<string, { failures: number; lockedUntil: number }>()

let dummyHash: Promise<string> | null = null
/** Verified against when the username does not exist, so response time does not leak that fact. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}

export interface CreateUserInput {
  username: string
  password: string
  role?: string
  branchId?: string | null
}

export async function createUser(ctx: AppContext, input: CreateUserInput): Promise<AuthenticatedUser> {
  const username = input.username.trim()
  if (username.length === 0) throw new AppError('VALIDATION_ERROR', 'Tên đăng nhập không được để trống')
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError('VALIDATION_ERROR', `Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`)
  }

  const exists = ctx.db.prepare('SELECT 1 AS found FROM users WHERE username = ?').get(username)
  if (exists) throw new AppError('CONFLICT', 'Tên đăng nhập đã tồn tại')

  const id = randomUUID()
  const role = input.role ?? 'owner'
  const branchId = input.branchId ?? null
  const passwordHash = await hashPassword(input.password)

  ctx.db
    .prepare(
      `INSERT INTO users (id, branch_id, username, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, branchId, username, passwordHash, role, ctx.now().toISOString())

  return { id, username, role, branchId }
}

export interface LoginResult {
  token: string
  user: AuthenticatedUser
}

export async function login(ctx: AppContext, usernameInput: string, password: string): Promise<LoginResult> {
  const username = usernameInput.trim()
  const key = username.toLowerCase()
  const nowMs = ctx.now().getTime()

  const row = ctx.db
    .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
    .get(username) as UserRow | undefined
  const unknown = unknownUserFailures.get(key)

  const lockedUntilMs = row?.locked_until ? Date.parse(row.locked_until) : (unknown?.lockedUntil ?? 0)
  if (lockedUntilMs > nowMs) {
    const minutes = Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 60_000))
    throw new AppError('RATE_LIMITED', `Đăng nhập sai quá nhiều lần, thử lại sau ${minutes} phút`)
  }

  const valid = await verifyPassword(password, row?.password_hash ?? (await getDummyHash()))
  if (!row || !valid) {
    recordFailure(ctx, row, key, nowMs)
    throw new AppError('UNAUTHENTICATED', 'Sai tên đăng nhập hoặc mật khẩu')
  }

  unknownUserFailures.delete(key)
  ctx.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(row.id)

  const token = randomBytes(32).toString('base64url')
  const nowIso = ctx.now().toISOString()
  ctx.db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), row.id, nowIso, new Date(nowMs + SESSION_TTL_MS).toISOString(), nowIso)

  return { token, user: toAuthenticatedUser(row) }
}

function recordFailure(ctx: AppContext, row: UserRow | undefined, key: string, nowMs: number): void {
  if (row) {
    const failures = row.failed_logins + 1
    const lockedUntil =
      failures % LOCK_AFTER_FAILURES === 0
        ? new Date(nowMs + lockMinutesFor(failures) * 60_000).toISOString()
        : null
    ctx.db
      .prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .run(failures, lockedUntil, row.id)
    if (lockedUntil) ctx.logger.warn({ component: 'auth', userId: row.id, failures }, 'account locked')
    return
  }

  const entry = unknownUserFailures.get(key) ?? { failures: 0, lockedUntil: 0 }
  entry.failures += 1
  if (entry.failures % LOCK_AFTER_FAILURES === 0) {
    entry.lockedUntil = nowMs + lockMinutesFor(entry.failures) * 60_000
  }
  unknownUserFailures.set(key, entry)
}

export interface SessionInfo {
  user: AuthenticatedUser
  sessionId: string
}

/** Returns the user for a session cookie, extending the session when it is getting old. */
export function findSession(ctx: AppContext, token: string | undefined): SessionInfo | null {
  if (!token) return null
  const sessionId = hashToken(token)
  const nowMs = ctx.now().getTime()

  const session = ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
    | SessionRow
    | undefined
  if (!session) return null

  if (Date.parse(session.expires_at) <= nowMs) {
    ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    return null
  }

  const row = ctx.db
    .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
    .get(session.user_id) as UserRow | undefined
  if (!row) return null

  if (nowMs - Date.parse(session.last_seen_at) > SESSION_REFRESH_AFTER_MS) {
    ctx.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(ctx.now().toISOString(), new Date(nowMs + SESSION_TTL_MS).toISOString(), sessionId)
  }
  return { user: toAuthenticatedUser(row), sessionId }
}

export function logout(ctx: AppContext, sessionId: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

export async function changePassword(
  ctx: AppContext,
  user: AuthenticatedUser,
  currentSessionId: string | null,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow | undefined
  if (!row || !(await verifyPassword(oldPassword, row.password_hash))) {
    throw new AppError('VALIDATION_ERROR', 'Mật khẩu cũ không đúng', { oldPassword: 'Mật khẩu cũ không đúng' })
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    const message = `Mật khẩu mới tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`
    throw new AppError('VALIDATION_ERROR', message, { newPassword: message })
  }

  const hash = await hashPassword(newPassword)
  ctx.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  // Anyone holding an older session must log in again with the new password.
  ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(user.id, currentSessionId ?? '')
}
