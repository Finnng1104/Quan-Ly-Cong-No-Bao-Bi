import type { FastifyInstance } from 'fastify'
import { findSession, SESSION_COOKIE } from '../modules/auth/service.js'
import { AppError } from '../shared/errors.js'
import type { AppContext } from './context.js'

const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/login'])

/**
 * Resolves the session cookie into `request.user` for every /api request, and rejects
 * unauthenticated calls to anything that is not explicitly public.
 */
export function registerAuthHook(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)

  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?')[0] ?? ''
    if (!path.startsWith('/api/')) return

    const session = findSession(ctx, request.cookies[SESSION_COOKIE])
    if (session) {
      request.user = session.user
      request.sessionId = session.sessionId
    }

    if (!session && !PUBLIC_PATHS.has(path)) {
      throw new AppError('UNAUTHENTICATED', 'Vui lòng đăng nhập')
    }
  })
}
