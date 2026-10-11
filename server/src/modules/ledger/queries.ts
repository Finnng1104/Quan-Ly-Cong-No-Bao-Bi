// SQL counterparts of the pure functions in ledger.ts. They answer the same questions straight
// from the database, so the server never loads the whole dataset into memory. Differential tests
// keep both implementations in agreement.

import type { Database } from '../../db/client.js'
import { fromQtyMilli } from '../../shared/money.js'
import type { LedgerEventKind } from './ledger.js'

export function customerBalance(
  db: Database,
  branchId: string,
  customerId: string,
  asOf: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS balance
         FROM ledger_events
        WHERE branch_id = ? AND customer_id = ? AND date <= ?`,
    )
    .get(branchId, customerId, asOf) as { balance: number }
  return row.balance
}

export function totalDebt(db: Database, branchId: string, asOf: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS total
         FROM ledger_events
        WHERE branch_id = ? AND date <= ?`,
    )
    .get(branchId, asOf) as { total: number }
  return row.total
}

/** The sentence shown for an event in a ledger or statement. Same wording as the web app. */
export function describeEvent(
  kind: LedgerEventKind,
  code: string | null,
  note: string | null,
  delta: number,
): string {
  switch (kind) {
    case 'opening':
      return 'Nợ đầu kỳ'
    case 'order':
      return `Đơn hàng ${String(code)}`
    case 'return':
      return 'Trả hàng'
    case 'payment':
      return 'Thanh toán'
    case 'adjust':
      return note || (delta >= 0 ? 'Phát sinh cộng nợ' : 'Phát sinh trừ nợ')
  }
}

export interface LedgerRowDto {
  date: string
  seq: number
  kind: LedgerEventKind
  desc: string
  refId: string | null
  code: string | null
  up: number
  down: number
  /** Debt after this event, counted from the very beginning of the customer's history. */
  balance: number
  /** True for orders that were edited after creation (the "Đã điều chỉnh" badge). */
  edited: boolean
}

interface EventRow {
  kind: LedgerEventKind
  ref_id: string
  code: string | null
  note: string | null
  date: string
  seq: number
  delta: number
  balance: number
  edited: number
}

function toRowDto(row: EventRow): LedgerRowDto {
  return {
    date: row.date,
    seq: row.seq,
    kind: row.kind,
    desc: describeEvent(row.kind, row.code, row.note, row.delta),
    refId: row.kind === 'opening' ? null : row.ref_id,
    code: row.code,
    up: row.delta > 0 ? row.delta : 0,
    down: row.delta < 0 ? -row.delta : 0,
    balance: row.balance,
    edited: row.edited === 1,
  }
}

// A running balance over the customer's whole history up to `until`. The window is computed
// before any date filter or paging is applied, so every row shows the true balance.
const RUNNING_BALANCE_SQL = `
  WITH ev AS (
    SELECT kind, ref_id, code, note, date, seq, rank, delta,
           SUM(delta) OVER (
             ORDER BY date, seq, rank ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS balance,
           CASE WHEN kind = 'order'
                 AND EXISTS (SELECT 1 FROM order_edits oe WHERE oe.order_id = ledger_events.ref_id)
                THEN 1 ELSE 0 END AS edited
      FROM ledger_events
     WHERE branch_id = @branchId AND customer_id = @customerId AND date <= @until
  )`

/** Newest first, the order the customer's ledger tab shows. */
export function ledgerPage(
  db: Database,
  branchId: string,
  customerId: string,
  until: string,
  limit: number,
  offset: number,
): { items: LedgerRowDto[]; total: number } {
  const rows = db
    .prepare(
      `${RUNNING_BALANCE_SQL}
       SELECT * FROM ev ORDER BY date DESC, seq DESC, rank DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ branchId, customerId, until, limit, offset }) as EventRow[]
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ledger_events
          WHERE branch_id = ? AND customer_id = ? AND date <= ?`,
      )
      .get(branchId, customerId, until) as { n: number }
  ).n
  return { items: rows.map(toRowDto), total }
}

/** Oldest first, only the events dated in [from, to]. */
export function ledgerRange(
  db: Database,
  branchId: string,
  customerId: string,
  from: string,
  to: string,
): LedgerRowDto[] {
  const rows = db
    .prepare(
      `${RUNNING_BALANCE_SQL}
       SELECT * FROM ev WHERE date >= @from ORDER BY date, seq, rank`,
    )
    .all({ branchId, customerId, until: to, from }) as EventRow[]
  return rows.map(toRowDto)
}

export interface PurchasedReturnedItem {
  productId: string
  unitId: string
  bought: number
  returned: number
}

/** Quantities bought and returned per product+unit, counting order return lines and return slips. */
export function purchasedReturnedFor(
  db: Database,
  branchId: string,
  customerId: string,
): PurchasedReturnedItem[] {
  const fromOrders = db
    .prepare(
      `SELECT ol.product_id AS product_id, ol.unit_id AS unit_id,
              SUM(CASE WHEN ol.type = 'sell' THEN ol.qty_milli ELSE 0 END) AS bought,
              SUM(CASE WHEN ol.type = 'return' THEN ol.qty_milli ELSE 0 END) AS returned
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id
        WHERE o.branch_id = ? AND o.customer_id = ? AND o.deleted_at IS NULL
        GROUP BY ol.product_id, ol.unit_id`,
    )
    .all(branchId, customerId) as { product_id: string; unit_id: string; bought: number; returned: number }[]

  const fromReturns = db
    .prepare(
      `SELECT rl.product_id AS product_id, rl.unit_id AS unit_id, SUM(rl.qty_milli) AS returned
         FROM return_lines rl JOIN returns r ON r.id = rl.return_id
        WHERE r.branch_id = ? AND r.customer_id = ? AND r.deleted_at IS NULL
        GROUP BY rl.product_id, rl.unit_id`,
    )
    .all(branchId, customerId) as { product_id: string; unit_id: string; returned: number }[]

  const merged = new Map<string, { productId: string; unitId: string; bought: number; returned: number }>()
  const entry = (productId: string, unitId: string) => {
    const key = `${productId}|${unitId}`
    let found = merged.get(key)
    if (!found) {
      found = { productId, unitId, bought: 0, returned: 0 }
      merged.set(key, found)
    }
    return found
  }
  for (const row of fromOrders) {
    const item = entry(row.product_id, row.unit_id)
    item.bought += row.bought
    item.returned += row.returned
  }
  for (const row of fromReturns) entry(row.product_id, row.unit_id).returned += row.returned

  return [...merged.values()].map((item) => ({
    productId: item.productId,
    unitId: item.unitId,
    bought: fromQtyMilli(item.bought),
    returned: fromQtyMilli(item.returned),
  }))
}

export function purchaseTotalsBetween(
  db: Database,
  branchId: string,
  customerId: string,
  from: string,
  to: string,
): { total: number; count: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
         FROM orders
        WHERE branch_id = ? AND customer_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?`,
    )
    .get(branchId, customerId, from, to) as { total: number; count: number }
  return row
}
