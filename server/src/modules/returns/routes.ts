import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { formatCode, nextCounter } from '../../shared/counters.js'
import { AppError } from '../../shared/errors.js'
import { fromPriceMilli, fromQtyMilli, lineAmount, MoneyError, toPriceMilli } from '../../shared/money.js'
import {
  idSchema,
  isoDateSchema,
  optionalText,
  paginationSchema,
  parseInput,
  priceSchema,
  qtySchema,
} from '../../shared/validation.js'
import { requireCustomer } from '../customers/service.js'
import { validateLineItem, type ReusableItems } from '../documents/line-validation.js'

interface ReturnRow {
  id: string
  code: string
  customer_id: string
  date: string
  seq: number
  total: number
  reason: string
  created_at: string
  deleted_at: string | null
}

interface ReturnLineRow {
  id: string
  product_id: string
  unit_id: string
  qty_milli: number
  price_milli: number
  amount: number
}

const lineSchema = z.object({
  productId: idSchema,
  unitId: idSchema,
  qty: qtySchema,
  price: priceSchema,
})

const createSchema = z.object({
  customerId: idSchema,
  date: isoDateSchema,
  lines: z.array(lineSchema).min(1, { error: 'Cần ít nhất một dòng hàng' }).max(200),
  reason: optionalText(500).default(''),
})

const listSchema = paginationSchema.extend({
  customerId: idSchema.optional(),
  date: isoDateSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  // Query strings carry no booleans; "1" lists the deleted ones instead, so they can be restored.
  deleted: z.enum(['0', '1'], { error: 'Chỉ nhận 0 hoặc 1' }).default('0'),
})

export function registerReturnRoutes(app: FastifyInstance, ctx: AppContext): void {
  const toDto = (row: ReturnRow) => {
    const lines = ctx.db
      .prepare(
        `SELECT id, product_id, unit_id, qty_milli, price_milli, amount
           FROM return_lines WHERE return_id = ? ORDER BY position`,
      )
      .all(row.id) as ReturnLineRow[]
    return {
      id: row.id,
      code: row.code,
      customerId: row.customer_id,
      date: row.date,
      seq: row.seq,
      lines: lines.map((line) => ({
        id: line.id,
        productId: line.product_id,
        unitId: line.unit_id,
        qty: fromQtyMilli(line.qty_milli),
        price: fromPriceMilli(line.price_milli),
        amount: line.amount,
      })),
      total: row.total,
      reason: row.reason,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    }
  }

  const requireRow = (branchId: string, id: string): ReturnRow => {
    const row = ctx.db.prepare('SELECT * FROM returns WHERE id = ? AND branch_id = ?').get(id, branchId) as
      | ReturnRow
      | undefined
    if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu trả hàng')
    return row
  }

  const prepareLines = (branchId: string, lines: z.infer<typeof lineSchema>[], reusable: ReusableItems | null) =>
    lines.map((line, index) => {
      const qtyMilli = validateLineItem(ctx, branchId, line, `lines[${index}]`, reusable)
      const priceMilli = toPriceMilli(line.price)
      let amount: number
      try {
        amount = lineAmount(qtyMilli, priceMilli)
      } catch (error) {
        if (error instanceof MoneyError) throw new AppError('VALIDATION_ERROR', 'Giá trị phiếu quá lớn')
        throw error
      }
      return { id: randomUUID(), ...line, qtyMilli, priceMilli, amount }
    })

  app.get('/api/returns', async (request) => {
    const { branchId } = authorize(request, 'returns:read')
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
        `SELECT * FROM returns WHERE ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit, offset: query.offset }) as ReturnRow[]
    const total = (
      ctx.db.prepare(`SELECT COUNT(*) AS n FROM returns WHERE ${where}`).get(params) as { n: number }
    ).n

    return { items: rows.map(toDto), total }
  })

  app.post('/api/returns', async (request, reply) => {
    const { branchId } = authorize(request, 'returns:write')
    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    const prepared = prepareLines(branchId, body.lines, null)
    const total = prepared.reduce((sum, line) => sum + line.amount, 0)

    const id = randomUUID()
    const nowIso = ctx.now().toISOString()
    const run = ctx.db.transaction(() => {
      const no = nextCounter(ctx.db, branchId, 'return_no')
      const seq = nextCounter(ctx.db, branchId, 'seq')
      ctx.db
        .prepare(
          `INSERT INTO returns (id, branch_id, code, customer_id, date, seq, total, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, branchId, formatCode('TH', no), body.customerId, body.date, seq, total, body.reason, nowIso)

      const insertLine = ctx.db.prepare(
        `INSERT INTO return_lines (id, return_id, position, product_id, unit_id, qty_milli, price_milli, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      prepared.forEach((line, position) => {
        insertLine.run(line.id, id, position, line.productId, line.unitId, line.qtyMilli, line.priceMilli, line.amount)
      })
    })
    run.immediate()

    reply.status(201)
    return toDto(requireRow(branchId, id))
  })

  app.get('/api/returns/:id', async (request) => {
    const { branchId } = authorize(request, 'returns:read')
    const { id } = request.params as { id: string }
    const row = requireRow(branchId, id)
    if (row.deleted_at) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu trả hàng')
    return toDto(row)
  })

  // Editing keeps the code, sequence number and creation time so the ledger order stays stable.
  app.put('/api/returns/:id', async (request) => {
    const { branchId } = authorize(request, 'returns:write')
    const { id } = request.params as { id: string }
    const existing = requireRow(branchId, id)
    if (existing.deleted_at) throw new AppError('NOT_FOUND', 'Không tìm thấy phiếu trả hàng')

    const body = parseInput(createSchema, request.body)
    requireCustomer(ctx.db, branchId, body.customerId)

    // A product or unit deleted since the return was created may still be kept on it.
    const previousLines = ctx.db
      .prepare('SELECT product_id, unit_id FROM return_lines WHERE return_id = ?')
      .all(id) as { product_id: string; unit_id: string }[]
    const reusable: ReusableItems = {
      productIds: new Set(previousLines.map((line) => line.product_id)),
      unitIds: new Set(previousLines.map((line) => line.unit_id)),
    }

    const prepared = prepareLines(branchId, body.lines, reusable)
    const total = prepared.reduce((sum, line) => sum + line.amount, 0)

    ctx.db
      .transaction(() => {
        ctx.db
          .prepare('UPDATE returns SET customer_id = ?, date = ?, total = ?, reason = ? WHERE id = ? AND branch_id = ?')
          .run(body.customerId, body.date, total, body.reason, id, branchId)
        ctx.db.prepare('DELETE FROM return_lines WHERE return_id = ?').run(id)
        const insertLine = ctx.db.prepare(
          `INSERT INTO return_lines (id, return_id, position, product_id, unit_id, qty_milli, price_milli, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        prepared.forEach((line, position) => {
          insertLine.run(line.id, id, position, line.productId, line.unitId, line.qtyMilli, line.priceMilli, line.amount)
        })
      })
      .immediate()

    return toDto(requireRow(branchId, id))
  })

  app.post('/api/returns/:id/restore', async (request) => {
    const { branchId } = authorize(request, 'returns:write')
    const { id } = request.params as { id: string }
    const row = requireRow(branchId, id)
    // A return cannot come back for a customer who has been deleted meanwhile.
    requireCustomer(ctx.db, branchId, row.customer_id)

    ctx.db.prepare('UPDATE returns SET deleted_at = NULL WHERE id = ? AND branch_id = ?').run(id, branchId)
    return toDto(requireRow(branchId, id))
  })

  app.delete('/api/returns/:id', async (request) => {
    const { branchId } = authorize(request, 'returns:write')
    const { id } = request.params as { id: string }
    requireRow(branchId, id)
    ctx.db
      .prepare('UPDATE returns SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND branch_id = ?')
      .run(ctx.now().toISOString(), id, branchId)
    return { ok: true }
  })
}
