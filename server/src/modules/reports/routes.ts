import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { addDays, dayBefore, monthStart, todayInShopZone } from '../../shared/dates.js'
import { isoDateSchema, parseInput } from '../../shared/validation.js'
import { totalDebt } from '../ledger/queries.js'

const SERIES_DAYS = 14
const TOP_DEBTORS = 5

const dashboardSchema = z.object({ date: isoDateSchema.optional() })
const debtsSchema = z.object({ asOf: isoDateSchema.optional() })

interface PeriodRow {
  orders: number
  orderCount: number
  payments: number
  paymentCount: number
  returns: number
}

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const today = (): string => todayInShopZone(ctx.now())

  /** Orders, payments and returns dated in [from, to]; adjustments are not part of these figures. */
  const periodTotals = (branchId: string, from: string, to: string): PeriodRow => {
    const orders = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n FROM orders
          WHERE branch_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?`,
      )
      .get(branchId, from, to) as { total: number; n: number }
    const payments = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payments
          WHERE branch_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?`,
      )
      .get(branchId, from, to) as { total: number; n: number }
    const returns = ctx.db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) AS total FROM returns
          WHERE branch_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?`,
      )
      .get(branchId, from, to) as { total: number }

    return {
      orders: orders.total,
      orderCount: orders.n,
      payments: payments.total,
      paymentCount: payments.n,
      returns: returns.total,
    }
  }

  app.get('/api/dashboard', async (request) => {
    const { branchId } = authorize(request, 'reports:read')
    const { date: requested } = parseInput(dashboardSchema, request.query)
    const date = requested ?? today()

    const day = periodTotals(branchId, date, date)
    const month = periodTotals(branchId, monthStart(date), date)

    const debtors = ctx.db
      .prepare(
        `SELECT customer_id, SUM(delta) AS balance
           FROM ledger_events
          WHERE branch_id = ? AND date <= ?
          GROUP BY customer_id
         HAVING SUM(delta) > 0`,
      )
      .all(branchId, date) as { customer_id: string; balance: number }[]

    const top = ctx.db
      .prepare(
        `SELECT c.id AS id, c.name AS name, c.phone AS phone, d.balance AS balance
           FROM (
             SELECT customer_id, SUM(delta) AS balance
               FROM ledger_events
              WHERE branch_id = @branchId AND date <= @date
              GROUP BY customer_id
             HAVING SUM(delta) > 0
           ) d
           JOIN customers c ON c.id = d.customer_id
          ORDER BY d.balance DESC, c.rowid
          LIMIT @limit`,
      )
      .all({ branchId, date, limit: TOP_DEBTORS }) as {
      id: string
      name: string
      phone: string
      balance: number
    }[]

    // Debt per day is a running sum: the debt before the window plus each day's net change.
    const startDate = addDays(date, -(SERIES_DAYS - 1))
    const baseline = totalDebt(ctx.db, branchId, dayBefore(startDate))
    const deltas = new Map<string, number>(
      (
        ctx.db
          .prepare(
            `SELECT date, SUM(delta) AS delta FROM ledger_events
              WHERE branch_id = ? AND date >= ? AND date <= ? GROUP BY date`,
          )
          .all(branchId, startDate, date) as { date: string; delta: number }[]
      ).map((row) => [row.date, row.delta]),
    )
    const sales = new Map<string, number>(
      (
        ctx.db
          .prepare(
            `SELECT date, SUM(total) AS total FROM orders
              WHERE branch_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ? GROUP BY date`,
          )
          .all(branchId, startDate, date) as { date: string; total: number }[]
      ).map((row) => [row.date, row.total]),
    )
    const collected = new Map<string, number>(
      (
        ctx.db
          .prepare(
            `SELECT date, SUM(amount) AS total FROM payments
              WHERE branch_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ? GROUP BY date`,
          )
          .all(branchId, startDate, date) as { date: string; total: number }[]
      ).map((row) => [row.date, row.total]),
    )

    let running = baseline
    const series = Array.from({ length: SERIES_DAYS }, (_, index) => {
      const day = addDays(startDate, index)
      running += deltas.get(day) ?? 0
      return {
        date: day,
        debt: running,
        sales: sales.get(day) ?? 0,
        collected: collected.get(day) ?? 0,
      }
    })

    return {
      date,
      totalDebt: totalDebt(ctx.db, branchId, date),
      debtorCount: debtors.length,
      day,
      month: {
        orders: month.orders,
        payments: month.payments,
        returns: month.returns,
        orderCount: month.orderCount,
      },
      series,
      topDebtors: top.map((row) => ({
        customerId: row.id,
        name: row.name,
        phone: row.phone,
        balance: row.balance,
      })),
    }
  })

  app.get('/api/reports/customer-debts', async (request) => {
    const { branchId } = authorize(request, 'reports:read')
    const { asOf: requested } = parseInput(debtsSchema, request.query)
    const asOf = requested ?? today()

    const rows = ctx.db
      .prepare(
        `SELECT c.id AS id, c.name AS name, c.phone AS phone,
                COALESCE(SUM(CASE WHEN e.kind = 'opening' THEN e.delta END), 0) AS opening,
                COALESCE(SUM(CASE WHEN e.kind = 'order'   THEN e.delta END), 0) AS orders,
                COALESCE(-SUM(CASE WHEN e.kind = 'return'  THEN e.delta END), 0) AS returns,
                COALESCE(-SUM(CASE WHEN e.kind = 'payment' THEN e.delta END), 0) AS payments,
                COALESCE(SUM(CASE WHEN e.kind = 'adjust'  THEN e.delta END), 0) AS adjust,
                COALESCE(SUM(e.delta), 0) AS end
           FROM customers c
           LEFT JOIN ledger_events e
                  ON e.customer_id = c.id AND e.branch_id = c.branch_id AND e.date <= @asOf
          WHERE c.branch_id = @branchId AND c.deleted_at IS NULL
          GROUP BY c.id
          ORDER BY c.rowid`,
      )
      .all({ branchId, asOf }) as {
      id: string
      name: string
      phone: string
      opening: number
      orders: number
      returns: number
      payments: number
      adjust: number
      end: number
    }[]

    return {
      asOf,
      items: rows.map((row) => ({
        customer: { id: row.id, name: row.name, phone: row.phone },
        opening: row.opening,
        orders: row.orders,
        returns: row.returns,
        payments: row.payments,
        adjust: row.adjust,
        end: row.end,
      })),
    }
  })
}
