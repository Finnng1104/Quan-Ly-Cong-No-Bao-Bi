import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { dayBefore, oneYearBefore, todayInShopZone } from '../../shared/dates.js'
import { isoDateSchema, paginationSchema, parseInput } from '../../shared/validation.js'
import { requireCustomer } from '../customers/service.js'
import {
  customerBalance,
  ledgerPage,
  ledgerRange,
  purchasedReturnedFor,
  purchaseTotalsBetween,
} from './queries.js'

const ledgerQuerySchema = paginationSchema.extend({
  until: isoDateSchema.optional(),
})

const rangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema })

interface ExportRow {
  id: string
  customer_id: string
  from_date: string
  to_date: string
  exported_at: string
}

interface EditedOrderRow {
  id: string
  code: string
  date: string
  last_edit_at: string
}

interface EditRow {
  edited_at: string
  old_total: number
  new_total: number
  diff: number
}

const toExportDto = (row: ExportRow) => ({
  id: row.id,
  customerId: row.customer_id,
  from: row.from_date,
  to: row.to_date,
  exportedAt: row.exported_at,
})

export function registerLedgerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const today = (): string => todayInShopZone(ctx.now())

  app.get('/api/customers/:id/ledger', async (request) => {
    const { branchId } = authorize(request, 'customers:read')
    const { id } = request.params as { id: string }
    const query = parseInput(ledgerQuerySchema, request.query)
    requireCustomer(ctx.db, branchId, id)

    const until = query.until ?? today()
    const page = ledgerPage(ctx.db, branchId, id, until, query.limit, query.offset)
    return {
      items: page.items,
      total: page.total,
      balance: customerBalance(ctx.db, branchId, id, until),
    }
  })

  app.get('/api/customers/:id/purchased-returned', async (request) => {
    const { branchId } = authorize(request, 'orders:read')
    const { id } = request.params as { id: string }
    requireCustomer(ctx.db, branchId, id)
    return { items: purchasedReturnedFor(ctx.db, branchId, id) }
  })

  app.get('/api/customers/:id/statement', async (request) => {
    const { branchId } = authorize(request, 'customers:read')
    const { id } = request.params as { id: string }
    const { from, to } = parseInput(rangeSchema, request.query)
    if (from > to) {
      throw new AppError('VALIDATION_ERROR', 'Ngày bắt đầu phải trước ngày kết thúc', {
        from: 'Ngày bắt đầu phải trước ngày kết thúc',
      })
    }
    requireCustomer(ctx.db, branchId, id)

    const opening = customerBalance(ctx.db, branchId, id, dayBefore(from))
    const rows = ledgerRange(ctx.db, branchId, id, from, to)
    const closing = rows.length > 0 ? (rows.at(-1)?.balance ?? opening) : opening

    // The most recent export of this customer is the marker for "edited since the last statement".
    const lastExport = ctx.db
      .prepare(
        `SELECT * FROM statement_exports WHERE branch_id = ? AND customer_id = ?
          ORDER BY exported_at DESC, rowid DESC LIMIT 1`,
      )
      .get(branchId, id) as ExportRow | undefined

    let editedOrders: {
      id: string
      code: string
      date: string
      lastEditAt: string
      latestEditSinceExport: { editedAt: string; oldTotal: number; newTotal: number; diff: number } | null
    }[] = []
    let totalDiff = 0

    if (lastExport) {
      const orders = ctx.db
        .prepare(
          `SELECT id, code, date, last_edit_at FROM orders
            WHERE branch_id = ? AND customer_id = ? AND deleted_at IS NULL AND last_edit_at > ?
            ORDER BY date, seq`,
        )
        .all(branchId, id, lastExport.exported_at) as EditedOrderRow[]

      const latestEdit = ctx.db.prepare(
        `SELECT edited_at, old_total, new_total, diff FROM order_edits
          WHERE order_id = ? AND edited_at > ? ORDER BY edited_at DESC, rowid DESC LIMIT 1`,
      )
      const sumDiff = ctx.db.prepare(
        `SELECT COALESCE(SUM(diff), 0) AS total FROM order_edits WHERE order_id = ? AND edited_at > ?`,
      )

      editedOrders = orders.map((order) => {
        const latest = latestEdit.get(order.id, lastExport.exported_at) as EditRow | undefined
        totalDiff += (sumDiff.get(order.id, lastExport.exported_at) as { total: number }).total
        return {
          id: order.id,
          code: order.code,
          date: order.date,
          lastEditAt: order.last_edit_at,
          latestEditSinceExport: latest
            ? {
                editedAt: latest.edited_at,
                oldTotal: latest.old_total,
                newTotal: latest.new_total,
                diff: latest.diff,
              }
            : null,
        }
      })
    }

    return {
      opening,
      closing,
      rows,
      lastExport: lastExport
        ? { exportedAt: lastExport.exported_at, from: lastExport.from_date, to: lastExport.to_date }
        : null,
      editedOrders,
      totalDiff,
      purchaseTotals: {
        range: purchaseTotalsBetween(ctx.db, branchId, id, from, to),
        last12Months: purchaseTotalsBetween(ctx.db, branchId, id, oneYearBefore(to), to),
      },
    }
  })

  app.post('/api/customers/:id/statement-exports', async (request, reply) => {
    const { branchId } = authorize(request, 'statements:write')
    const { id } = request.params as { id: string }
    const { from, to } = parseInput(rangeSchema, request.body)
    if (from > to) {
      throw new AppError('VALIDATION_ERROR', 'Ngày bắt đầu phải trước ngày kết thúc', {
        from: 'Ngày bắt đầu phải trước ngày kết thúc',
      })
    }
    requireCustomer(ctx.db, branchId, id)

    const exportId = randomUUID()
    ctx.db
      .prepare(
        `INSERT INTO statement_exports (id, branch_id, customer_id, from_date, to_date, exported_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(exportId, branchId, id, from, to, ctx.now().toISOString())

    reply.status(201)
    return toExportDto(
      ctx.db.prepare('SELECT * FROM statement_exports WHERE id = ?').get(exportId) as ExportRow,
    )
  })
}
