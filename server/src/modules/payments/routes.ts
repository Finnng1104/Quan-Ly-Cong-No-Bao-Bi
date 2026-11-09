import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { formatCode, nextCounter } from '../../shared/counters.js'
import { AppError } from '../../shared/errors.js'
import {
  idSchema,
  isoDateSchema,
  optionalText,
  paginationSchema,
  parseInput,
  positiveMoneySchema,
} from '../../shared/validation.js'
import { requireCustomer } from '../customers/service.js'

interface PaymentRow {
  id: string
  code: string
  customer_id: string
  date: string
  seq: number
  amount: number
  note: string
  created_at: string
  deleted_at: string | null
}

const createSchema = z.object({
  customerId: idSchema,
  date: isoDateSchema,
  amount: positiveMoneySchema,
  note: optionalText(500).default(''),
})

const listSchema = paginationSchema.extend({
  customerId: idSchema.optional(),
  date: isoDateSchema.optional(),
})

const toDto = (row: PaymentRow) => ({
  id: row.id,
  code: row.code,
  customerId: row.customer_id,
  date: row.date,
  seq: row.seq,
  amount: row.amount,
  note: row.note,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

export function registerPaymentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/payments', async (request) => {
    const { branchId } = authorize(request, 'payments:read')
    const query = parseInput(listSchema, request.query)

    const conditions = ['branch_id = @branchId', 'deleted_at IS NULL']
    const params: Record<string, string | number> = { branchId }
    if (query.customerId) {
      conditions.push('customer_id = @customerId')
      params['customerId'] = query.customerId
    }
    if (query.date) {
      conditions.push('date = @date')
      params['date'] = query.date
    }
    const where = conditions.join(' AND ')

    const rows = ctx.db
      .prepare(
        `SELECT * FROM payments WHERE ${where} ORDER BY date DESC, seq DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit, offset: query.offset }) as PaymentRow[]
    const total = (
      ctx.db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE ${where}`).get(params) as { n: number }
    ).n

    return { items: rows.map(toDto), total }
  })

  app.post('/api/payments', async (request, reply) => {
    const { branchId } = authorize(request, 'payments:write')
    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    const id = randomUUID()
    const run = ctx.db.transaction(() => {
      const no = nextCounter(ctx.db, branchId, 'payment_no')
      const seq = nextCounter(ctx.db, branchId, 'seq')
      ctx.db
        .prepare(
          `INSERT INTO payments (id, branch_id, code, customer_id, date, seq, amount, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          branchId,
          formatCode('TT', no),
          body.customerId,
          body.date,
          seq,
          body.amount,
          body.note,
          ctx.now().toISOString(),
        )
    })
    run.immediate()

    reply.status(201)
    return toDto(ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow)
  })

  // Editing keeps the code, sequence number and creation time so the ledger order stays stable.
  app.put('/api/payments/:id', async (request) => {
    const { branchId } = authorize(request, 'payments:write')
    const { id } = request.params as { id: string }
    const existing = ctx.db
      .prepare('SELECT deleted_at FROM payments WHERE id = ? AND branch_id = ?')
      .get(id, branchId) as { deleted_at: string | null } | undefined
    if (!existing || existing.deleted_at) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu thu')

    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    ctx.db
      .prepare('UPDATE payments SET customer_id = ?, date = ?, amount = ?, note = ? WHERE id = ? AND branch_id = ?')
      .run(body.customerId, body.date, body.amount, body.note, id, branchId)
    return toDto(ctx.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow)
  })

  app.delete('/api/payments/:id', async (request) => {
    const { branchId } = authorize(request, 'payments:write')
    const { id } = request.params as { id: string }
    const row = ctx.db.prepare('SELECT id FROM payments WHERE id = ? AND branch_id = ?').get(id, branchId)
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu thu')

    ctx.db
      .prepare('UPDATE payments SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND branch_id = ?')
      .run(ctx.now().toISOString(), id, branchId)
    return { ok: true }
  })
}
