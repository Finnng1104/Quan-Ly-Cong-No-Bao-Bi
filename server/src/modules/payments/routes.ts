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
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  // Query strings carry no booleans; "1" lists the deleted ones instead, so they can be restored.
  deleted: z.enum(['0', '1'], { error: 'Chỉ nhận 0 hoặc 1' }).default('0'),
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

    const listDeleted = query.deleted === '1'
    const conditions = ['branch_id = @branchId', listDeleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
    const params: Record<string, string | number> = { branchId }
    if (query.customerId) {
      conditions.push('customer_id = @customerId')
      params['customerId'] = query.customerId
    }
    if (query.date) {
      conditions.push('date = @date')
      params['date'] = query.date
    }
    if (query.from) {
      conditions.push('date >= @from')
      params['from'] = query.from
    }
    if (query.to) {
      conditions.push('date <= @to')
      params['to'] = query.to
    }
    const where = conditions.join(' AND ')
    // The one deleted by mistake a minute ago must be at the top, whatever its date.
    const orderBy = listDeleted ? 'deleted_at DESC, date DESC, seq DESC' : 'date DESC, seq DESC'

    const rows = ctx.db
      .prepare(
        `SELECT * FROM payments WHERE ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
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

  app.get('/api/payments/:id', async (request) => {
    const { branchId } = authorize(request, 'payments:read')
    const { id } = request.params as { id: string }
    const row = ctx.db
      .prepare('SELECT * FROM payments WHERE id = ? AND branch_id = ? AND deleted_at IS NULL')
      .get(id, branchId) as PaymentRow | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu thu')
    return toDto(row)
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

  app.post('/api/payments/:id/restore', async (request) => {
    const { branchId } = authorize(request, 'payments:write')
    const { id } = request.params as { id: string }
    const row = ctx.db
      .prepare('SELECT customer_id FROM payments WHERE id = ? AND branch_id = ?')
      .get(id, branchId) as { customer_id: string } | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu thu')
    // A payment cannot come back for a customer who has been deleted meanwhile.
    requireCustomer(ctx.db, branchId, row.customer_id)

    ctx.db.prepare('UPDATE payments SET deleted_at = NULL WHERE id = ? AND branch_id = ?').run(id, branchId)
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
