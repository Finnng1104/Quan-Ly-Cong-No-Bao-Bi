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
import { validateLineItem } from '../documents/line-validation.js'

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

  app.get('/api/returns', async (request) => {
    const { branchId } = authorize(request, 'returns:read')
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
        `SELECT * FROM returns WHERE ${where} ORDER BY date DESC, seq DESC LIMIT @limit OFFSET @offset`,
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

    const prepared = body.lines.map((line, index) => {
      const qtyMilli = validateLineItem(ctx, branchId, line, `lines[${index}]`, null)
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
