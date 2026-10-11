import type { FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import type { Database } from '../db/client.js'
import { AppError } from '../shared/errors.js'
import { assertCan, type Action, type AuthenticatedUser } from '../shared/policy.js'
import { DEFAULT_BRANCH_ID } from '../shared/scope.js'

/** What every module needs from the application. Passed explicitly so tests can swap the clock. */
export interface AppContext {
  db: Database
  logger: Logger
  now(): Date
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook; null on public routes. */
    user: AuthenticatedUser | null
    /** Hash of the session token, used to keep the current session when others are revoked. */
    sessionId: string | null
  }
}

export interface RequestScope {
  user: AuthenticatedUser
  branchId: string
}

/** Resolves who is calling and which branch their data lives in, after checking permission. */
export function authorize(request: FastifyRequest, action: Action): RequestScope {
  const user = request.user
  if (!user) throw new AppError('UNAUTHENTICATED', 'Vui lòng đăng nhập')
  assertCan(user, action)
  return { user, branchId: user.branchId ?? DEFAULT_BRANCH_ID }
}
