import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { formatCode, nextCounter } from '../../shared/counters.js'
import { AppError } from '../../shared/errors.js'
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  optionalText,
  paginationSchema,
  parseInput,
} from '../../shared/validation.js'
import { requireCustomer } from '../customers/service.js'

interface AdjustmentRow {
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
  // Signed: positive adds to the customer's debt (shipping, VAT), negative reduces it (discount).
  amount: moneySchema.refine((value) => value !== 0, { error: 'Số tiền phải khác 0' }),
  note: optionalText(500).default(''),
})

const listSchema = paginationSchema.extend({
  customerId: idSchema.optional(),
})

const toDto = (row: AdjustmentRow) => ({
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

export function registerAdjustmentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/adjustments', async (request) => {
    const { branchId } = authorize(request, 'adjustments:read')
    const query = parseInput(listSchema, request.query)

    const conditions = ['branch_id = @branchId', 'deleted_at IS NULL']
    const params: Record<string, string | number> = { branchId }
    if (query.customerId) {
      conditions.push('customer_id = @customerId')
      params['customerId'] = query.customerId
    }
    const where = conditions.join(' AND ')

    const rows = ctx.db
      .prepare(
        `SELECT * FROM adjustments WHERE ${where} ORDER BY date DESC, seq DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit, offset: query.offset }) as AdjustmentRow[]
    const total = (
      ctx.db.prepare(`SELECT COUNT(*) AS n FROM adjustments WHERE ${where}`).get(params) as { n: number }
    ).n

    return { items: rows.map(toDto), total }
  })

  app.post('/api/adjustments', async (request, reply) => {
    const { branchId } = authorize(request, 'adjustments:write')
    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    const id = randomUUID()
    const run = ctx.db.transaction(() => {
      const no = nextCounter(ctx.db, branchId, 'adjust_no')
      const seq = nextCounter(ctx.db, branchId, 'seq')
      ctx.db
        .prepare(
          `INSERT INTO adjustments (id, branch_id, code, customer_id, date, seq, amount, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          branchId,
          formatCode('PS', no),
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
    return toDto(ctx.db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id) as AdjustmentRow)
  })

  app.get('/api/adjustments/:id', async (request) => {
    const { branchId } = authorize(request, 'adjustments:read')
    const { id } = request.params as { id: string }
    const row = ctx.db
      .prepare('SELECT * FROM adjustments WHERE id = ? AND branch_id = ? AND deleted_at IS NULL')
      .get(id, branchId) as AdjustmentRow | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phát sinh')
    return toDto(row)
  })

  // Editing keeps the code, sequence number and creation time so the ledger order stays stable.
  app.put('/api/adjustments/:id', async (request) => {
    const { branchId } = authorize(request, 'adjustments:write')
    const { id } = request.params as { id: string }
    const existing = ctx.db
      .prepare('SELECT deleted_at FROM adjustments WHERE id = ? AND branch_id = ?')
      .get(id, branchId) as { deleted_at: string | null } | undefined
    if (!existing || existing.deleted_at) throw new AppError('NOT_FOUND', 'Không tìm thấy phát sinh')

    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    ctx.db
      .prepare('UPDATE adjustments SET customer_id = ?, date = ?, amount = ?, note = ? WHERE id = ? AND branch_id = ?')
      .run(body.customerId, body.date, body.amount, body.note, id, branchId)
    return toDto(ctx.db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id) as AdjustmentRow)
  })

  app.delete('/api/adjustments/:id', async (request) => {
    const { branchId } = authorize(request, 'adjustments:write')
    const { id } = request.params as { id: string }
    const row = ctx.db.prepare('SELECT id FROM adjustments WHERE id = ? AND branch_id = ?').get(id, branchId)
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phát sinh')

    ctx.db
      .prepare('UPDATE adjustments SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND branch_id = ?')
      .run(ctx.now().toISOString(), id, branchId)
    return { ok: true }
  })
}
