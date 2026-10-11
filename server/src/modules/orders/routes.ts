import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { todayInShopZone } from '../../shared/dates.js'
import {
  idSchema,
  isoDateSchema,
  moneySchema,
  optionalText,
  paginationSchema,
  parseInput,
  priceSchema,
  qtySchema,
} from '../../shared/validation.js'
import {
  createOrder,
  readEditHistory,
  requireOrderRow,
  setOrderDeleted,
  toOrderDto,
  updateOrder,
  type OrderInput,
} from './service.js'

const lineSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(['sell', 'return']).default('sell'),
  productId: idSchema,
  unitId: idSchema,
  qty: qtySchema,
  price: priceSchema,
})

const vatSchema = z
  .object({
    ratePercent: z.number({ error: 'Phải là số' }).min(0).max(100).optional(),
    amount: moneySchema.min(0, { error: 'Không được âm' }).optional(),
  })
  .nullable()

const feeSchema = z.object({
  id: idSchema.optional(),
  name: optionalText(100).default(''),
  amount: moneySchema,
})

const orderBodySchema = z.object({
  customerId: idSchema,
  date: isoDateSchema,
  lines: z.array(lineSchema).min(1, { error: 'Cần ít nhất một dòng hàng' }).max(200),
  vat: vatSchema.default(null),
  fees: z.array(feeSchema).max(50).default([]),
  note: optionalText(2000).default(''),
})

const updateBodySchema = orderBodySchema.extend({
  version: z.number({ error: 'Bắt buộc' }).int().min(1),
})

const listSchema = paginationSchema.extend({
  date: isoDateSchema.optional(),
  customerId: idSchema.optional(),
})

interface ListedOrderRow {
  id: string
}

export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const today = (): string => todayInShopZone(ctx.now())

  app.get('/api/orders', async (request) => {
    const { branchId } = authorize(request, 'orders:read')
    const query = parseInput(listSchema, request.query)

    const conditions = ['branch_id = @branchId', 'deleted_at IS NULL']
    const params: Record<string, string | number> = { branchId }
    if (query.date) {
      conditions.push('date = @date')
      params['date'] = query.date
    }
    if (query.customerId) {
      conditions.push('customer_id = @customerId')
      params['customerId'] = query.customerId
    }
    const where = conditions.join(' AND ')

    const ids = ctx.db
      .prepare(
        `SELECT id FROM orders WHERE ${where}
          ORDER BY date DESC, seq DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit: query.limit, offset: query.offset }) as ListedOrderRow[]

    const totals = ctx.db
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(total), 0) AS filteredTotal FROM orders WHERE ${where}`)
      .get(params) as { total: number; filteredTotal: number }

    // The "end of day" figure ignores the customer filter, like the web app's list page.
    const dayTotal = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS dayTotal FROM orders
          WHERE branch_id = ? AND deleted_at IS NULL AND date = ?`,
      )
      .get(branchId, query.date ?? today()) as { dayTotal: number }

    const items = ids.map(({ id }) => {
      const row = requireOrderRow(ctx, branchId, id)
      const editCount = (
        ctx.db.prepare('SELECT COUNT(*) AS n FROM order_edits WHERE order_id = ?').get(id) as { n: number }
      ).n
      return { ...toOrderDto(ctx, row), editCount }
    })

    return {
      items,
      total: totals.total,
      summary: { filteredTotal: totals.filteredTotal, dayTotal: dayTotal.dayTotal },
    }
  })

  app.post('/api/orders', async (request, reply) => {
    const { branchId } = authorize(request, 'orders:write')
    const body = parseInput(orderBodySchema, request.body)
    const order = createOrder(ctx, branchId, body as OrderInput)
    reply.status(201)
    return order
  })

  app.get('/api/orders/:id', async (request) => {
    const { branchId } = authorize(request, 'orders:read')
    const { id } = request.params as { id: string }
    const row = requireOrderRow(ctx, branchId, id)

    // Debt right before this order: everything that sorts earlier by (date, seq, kind rank).
    // Orders have kind rank 1, so only same-day events with a lower seq (or lower rank) count.
    const before = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(delta), 0) AS balance
           FROM ledger_events
          WHERE branch_id = @branchId AND customer_id = @customerId
            AND (date < @date
              OR (date = @date AND seq < @seq)
              OR (date = @date AND seq = @seq AND rank < 1))`,
      )
      .get({ branchId, customerId: row.customer_id, date: row.date, seq: row.seq }) as { balance: number }

    return {
      ...toOrderDto(ctx, row),
      balanceBefore: before.balance,
      balanceAfter: before.balance + row.total,
      editHistory: readEditHistory(ctx, id),
    }
  })

  app.put('/api/orders/:id', async (request) => {
    const { branchId } = authorize(request, 'orders:write')
    const { id } = request.params as { id: string }
    const { version, ...body } = parseInput(updateBodySchema, request.body)
    return updateOrder(ctx, branchId, id, body as OrderInput, version).order
  })

  app.delete('/api/orders/:id', async (request) => {
    const { branchId } = authorize(request, 'orders:write')
    const { id } = request.params as { id: string }
    return setOrderDeleted(ctx, branchId, id, true)
  })

  app.post('/api/orders/:id/restore', async (request) => {
    const { branchId } = authorize(request, 'orders:write')
    const { id } = request.params as { id: string }
    return setOrderDeleted(ctx, branchId, id, false)
  })
}
