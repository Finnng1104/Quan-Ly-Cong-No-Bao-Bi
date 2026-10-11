import type { FastifyInstance } from 'fastify'
import { AppError } from './errors.js'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Defences for a server that only ever listens on localhost (decision D-33):
 *
 * - Host allowlist: a malicious site can point its own domain at 127.0.0.1 (DNS rebinding)
 *   and then talk to us; the browser would send that foreign domain as the Host header.
 * - Exact Origin on writes: SameSite cookies are scoped by *site*, not by port, so another
 *   app on localhost:3000 would still be same-site. Only our own origin may write.
 * - JSON-only bodies: rules out "simple" cross-site form posts (text/plain, multipart...).
 */
export function registerRequestGuard(app: FastifyInstance, options: { port: number }): void {
  const allowedHosts = new Set([`localhost:${options.port}`, `127.0.0.1:${options.port}`])
  const allowedOrigins = new Set([
    `http://localhost:${options.port}`,
    `http://127.0.0.1:${options.port}`,
  ])

  app.addHook('onRequest', async (request) => {
    const host = (request.headers.host ?? '').toLowerCase()
    if (!allowedHosts.has(host)) {
      throw new AppError('FORBIDDEN', 'Địa chỉ truy cập không hợp lệ')
    }

    if (!WRITE_METHODS.has(request.method)) return

    const origin = (request.headers.origin ?? '').toLowerCase()
    if (!allowedOrigins.has(origin)) {
      throw new AppError('FORBIDDEN', 'Nguồn yêu cầu không hợp lệ')
    }

    const hasBody =
      request.headers['transfer-encoding'] !== undefined ||
      Number(request.headers['content-length'] ?? 0) > 0
    if (hasBody && !(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new AppError('VALIDATION_ERROR', 'Chỉ chấp nhận dữ liệu dạng JSON')
    }
  })
}
