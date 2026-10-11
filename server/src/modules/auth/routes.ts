import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { nonEmptyText, parseInput } from '../../shared/validation.js'
import { changePassword, login, logout, SESSION_COOKIE, SESSION_TTL_MS } from './service.js'

const loginSchema = z.object({
  username: nonEmptyText(100),
  password: z.string({ error: 'Bắt buộc' }).min(1, { error: 'Bắt buộc' }).max(200),
})

const changePasswordSchema = z.object({
  oldPassword: z.string({ error: 'Bắt buộc' }).min(1, { error: 'Bắt buộc' }).max(200),
  newPassword: z.string({ error: 'Bắt buộc' }).max(200),
})

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/login', async (request, reply) => {
    const body = parseInput(loginSchema, request.body)
    const { token, user } = await login(ctx, body.username, body.password)

    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // Plain http on localhost, so `secure` cannot be set; the cookie never leaves this machine.
      secure: false,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    })
    return { username: user.username, role: user.role }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionId) logout(ctx, request.sessionId)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async (request) => {
    if (!request.user) throw new AppError('UNAUTHENTICATED', 'Vui lòng đăng nhập')
    return { username: request.user.username, role: request.user.role }
  })

  app.post('/api/auth/change-password', async (request) => {
    if (!request.user) throw new AppError('UNAUTHENTICATED', 'Vui lòng đăng nhập')
    const body = parseInput(changePasswordSchema, request.body)
    await changePassword(ctx, request.user, request.sessionId, body.oldPassword, body.newPassword)
    return { ok: true }
  })
}
