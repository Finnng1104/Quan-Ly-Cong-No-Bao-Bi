// Customer debt rules, ported from the web app's src/lib/debt.js.
//
//  - Debt of a customer on day X = opening debt + orders + adjustments - returns - payments,
//    counting only events dated on or before X.
//  - Debt is per customer. A payment reduces the shared balance; it is never allocated to orders.
//  - Debt is always recomputed from the current events, so editing an old order changes every
//    later balance consistently.
//  - Events are ordered by (date, seq, kind rank); `seq` is the creation order inside a day.
//
// These functions are pure and work on in-memory data. The HTTP layer computes the same numbers
// with SQL; differential tests keep the two in agreement.

import { addDays, dayBefore } from '../../shared/dates.js'
import { fromQtyMilli, toQtyMilli } from '../../shared/money.js'
import type { LedgerCustomer, LedgerData } from './types.js'

export const KIND = {
  OPENING: 'opening',
  ORDER: 'order',
  RETURN: 'return',
  PAYMENT: 'payment',
  ADJUST: 'adjust',
} as const

export type LedgerEventKind = (typeof KIND)[keyof typeof KIND]

// Tie-break for events that share date and seq (only possible with legacy records lacking seq).
const KIND_RANK: Record<LedgerEventKind, number> = {
  opening: 0,
  order: 1,
  adjust: 2,
  return: 3,
  payment: 4,
}

export interface LedgerEvent {
  kind: LedgerEventKind
  date: string
  seq: number
  /** Effect on the customer's debt: positive = owes more. */
  delta: number
  /** Id of the order/return/payment/adjustment; null for the opening balance. */
  refId: string | null
  code?: string
  desc: string
}

interface EventPosition {
  kind: LedgerEventKind
  date: string
  seq: number
}

function compareEvents(a: EventPosition, b: EventPosition): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.seq !== b.seq) return a.seq - b.seq
  return KIND_RANK[a.kind] - KIND_RANK[b.kind]
}

/** Every event of one customer in ledger order, including the opening balance. */
export function eventsFor(customerId: string, data: LedgerData): LedgerEvent[] {
  const events: LedgerEvent[] = []

  const customer = data.customers.find((candidate) => candidate.id === customerId)
  if (customer?.openingDebt && Number(customer.openingDebt.amount)) {
    events.push({
      kind: KIND.OPENING,
      date: customer.openingDebt.date,
      seq: -1,
      delta: Number(customer.openingDebt.amount),
      refId: null,
      desc: 'Nợ đầu kỳ',
    })
  }

  for (const order of data.orders) {
    if (order.customerId !== customerId || order.deletedAt) continue
    events.push({
      kind: KIND.ORDER,
      date: order.date,
      seq: order.seq ?? 0,
      delta: Number(order.total),
      refId: order.id,
      code: order.code,
      desc: `Đơn hàng ${order.code}`,
    })
  }

  for (const goodsReturn of data.returns) {
    if (goodsReturn.customerId !== customerId || goodsReturn.deletedAt) continue
    events.push({
      kind: KIND.RETURN,
      date: goodsReturn.date,
      seq: goodsReturn.seq ?? 0,
      delta: -Number(goodsReturn.total),
      refId: goodsReturn.id,
      desc: 'Trả hàng',
    })
  }

  for (const payment of data.payments) {
    if (payment.customerId !== customerId || payment.deletedAt) continue
    events.push({
      kind: KIND.PAYMENT,
      date: payment.date,
      seq: payment.seq ?? 0,
      delta: -Number(payment.amount),
      refId: payment.id,
      desc: 'Thanh toán',
    })
  }

  for (const adjustment of data.adjustments ?? []) {
    if (adjustment.customerId !== customerId || adjustment.deletedAt) continue
    const amount = Number(adjustment.amount)
    events.push({
      kind: KIND.ADJUST,
      date: adjustment.date,
      seq: adjustment.seq ?? 0,
      delta: amount,
      refId: adjustment.id,
      desc: adjustment.note || (amount >= 0 ? 'Phát sinh cộng nợ' : 'Phát sinh trừ nợ'),
    })
  }

  return events.sort(compareEvents)
}

/** Debt of one customer on `date`, counting events dated on or before it. */
export function balanceAt(customerId: string, data: LedgerData, date: string): number {
  let sum = 0
  for (const event of eventsFor(customerId, data)) {
    if (event.date <= date) sum += event.delta
  }
  return sum
}

/**
 * Debt right before a given order: the "old debt" printed on its ticket. With several orders on
 * one day, the old debt of a later order equals the new debt of the earlier one.
 */
export function balanceBeforeOrder(
  customerId: string,
  data: LedgerData,
  order: { id: string; date: string; seq?: number },
): number {
  const target: EventPosition = { kind: KIND.ORDER, date: order.date, seq: order.seq ?? 0 }
  let sum = 0
  for (const event of eventsFor(customerId, data)) {
    if (event.refId === order.id) break
    if (compareEvents(event, target) < 0) sum += event.delta
  }
  return sum
}

/** customerId -> debt on `date`, for every customer. */
export function debtsByCustomer(data: LedgerData, date: string): Record<string, number> {
  const debts: Record<string, number> = {}
  for (const customer of data.customers) debts[customer.id] = balanceAt(customer.id, data, date)
  return debts
}

export function totalDebtAt(data: LedgerData, date: string): number {
  let sum = 0
  for (const customer of data.customers) sum += balanceAt(customer.id, data, date)
  return sum
}

export interface DayActivity {
  /** Orders created that day. */
  up: number
  /** Payments plus returns that day. Adjustments are deliberately not counted (matches the app). */
  down: number
}

export function dayActivitiesByCustomer(data: LedgerData, date: string): Record<string, DayActivity> {
  const activities: Record<string, DayActivity> = {}
  const activityOf = (customerId: string): DayActivity =>
    (activities[customerId] ??= { up: 0, down: 0 })

  for (const order of data.orders) {
    if (!order.deletedAt && order.date === date) activityOf(order.customerId).up += Number(order.total)
  }
  for (const goodsReturn of data.returns) {
    if (!goodsReturn.deletedAt && goodsReturn.date === date) {
      activityOf(goodsReturn.customerId).down += Number(goodsReturn.total)
    }
  }
  for (const payment of data.payments) {
    if (!payment.deletedAt && payment.date === date) {
      activityOf(payment.customerId).down += Number(payment.amount)
    }
  }
  return activities
}

export interface DailyTotals {
  orders: number
  orderCount: number
  payments: number
  paymentCount: number
  returns: number
}

export function dailyTotals(data: LedgerData, date: string): DailyTotals {
  const totals: DailyTotals = { orders: 0, orderCount: 0, payments: 0, paymentCount: 0, returns: 0 }
  for (const order of data.orders) {
    if (!order.deletedAt && order.date === date) {
      totals.orders += Number(order.total)
      totals.orderCount += 1
    }
  }
  for (const payment of data.payments) {
    if (!payment.deletedAt && payment.date === date) {
      totals.payments += Number(payment.amount)
      totals.paymentCount += 1
    }
  }
  for (const goodsReturn of data.returns) {
    if (!goodsReturn.deletedAt && goodsReturn.date === date) totals.returns += Number(goodsReturn.total)
  }
  return totals
}

export interface RangeTotals {
  orders: number
  payments: number
  returns: number
  orderCount: number
}

/** Orders / payments / returns whose date is in [from, to], inclusive. */
export function rangeTotals(data: LedgerData, from: string, to: string): RangeTotals {
  const totals: RangeTotals = { orders: 0, payments: 0, returns: 0, orderCount: 0 }
  for (const order of data.orders) {
    if (!order.deletedAt && order.date >= from && order.date <= to) {
      totals.orders += Number(order.total)
      totals.orderCount += 1
    }
  }
  for (const payment of data.payments) {
    if (!payment.deletedAt && payment.date >= from && payment.date <= to) {
      totals.payments += Number(payment.amount)
    }
  }
  for (const goodsReturn of data.returns) {
    if (!goodsReturn.deletedAt && goodsReturn.date >= from && goodsReturn.date <= to) {
      totals.returns += Number(goodsReturn.total)
    }
  }
  return totals
}

export interface LedgerRow {
  date: string
  seq: number
  kind: LedgerEventKind
  desc: string
  refId: string | null
  code?: string | undefined
  up: number
  down: number
  balance: number
}

/** Statement of one customer for [from, to]: opening balance, rows with running balance, closing. */
export function ledgerRows(
  customerId: string,
  data: LedgerData,
  from: string,
  to: string,
): { opening: number; rows: LedgerRow[]; closing: number } {
  const opening = balanceAt(customerId, data, dayBefore(from))
  let balance = opening
  const rows: LedgerRow[] = []

  for (const event of eventsFor(customerId, data)) {
    if (event.date < from || event.date > to) continue
    balance += event.delta
    rows.push({
      date: event.date,
      seq: event.seq,
      kind: event.kind,
      desc: event.desc,
      refId: event.refId,
      code: event.code,
      up: event.delta > 0 ? event.delta : 0,
      down: event.delta < 0 ? -event.delta : 0,
      balance,
    })
  }
  return { opening, rows, closing: balance }
}

export interface FullLedgerRow extends LedgerEvent {
  up: number
  down: number
  balance: number
}

/** Every event of a customer (optionally up to `until`) with the running balance since the beginning. */
export function fullLedger(customerId: string, data: LedgerData, until?: string): FullLedgerRow[] {
  let balance = 0
  const rows: FullLedgerRow[] = []
  for (const event of eventsFor(customerId, data)) {
    if (until && event.date > until) break
    balance += event.delta
    rows.push({
      ...event,
      up: event.delta > 0 ? event.delta : 0,
      down: event.delta < 0 ? -event.delta : 0,
      balance,
    })
  }
  return rows
}

export interface PurchasedReturned {
  bought: number
  returned: number
}

/**
 * Quantity bought / returned per "productId|unitId" for one customer, counting return lines in
 * orders as well as separate return slips. Summed in milli-units so decimals do not drift.
 */
export function purchasedReturned(customerId: string, data: LedgerData): Map<string, PurchasedReturned> {
  const milli = new Map<string, { bought: number; returned: number }>()
  const entryFor = (productId: string, unitId: string): { bought: number; returned: number } => {
    const key = `${productId}|${unitId}`
    let entry = milli.get(key)
    if (!entry) {
      entry = { bought: 0, returned: 0 }
      milli.set(key, entry)
    }
    return entry
  }

  for (const order of data.orders) {
    if (order.customerId !== customerId || order.deletedAt) continue
    for (const line of order.lines) {
      const entry = entryFor(line.productId, line.unitId)
      const qty = toQtyMilli(Number(line.qty))
      if (line.type === 'return') entry.returned += qty
      else entry.bought += qty
    }
  }
  for (const goodsReturn of data.returns) {
    if (goodsReturn.customerId !== customerId || goodsReturn.deletedAt) continue
    for (const line of goodsReturn.lines) {
      entryFor(line.productId, line.unitId).returned += toQtyMilli(Number(line.qty))
    }
  }

  const result = new Map<string, PurchasedReturned>()
  for (const [key, entry] of milli) {
    result.set(key, { bought: fromQtyMilli(entry.bought), returned: fromQtyMilli(entry.returned) })
  }
  return result
}

export interface CustomerDebtRow {
  customer: LedgerCustomer
  opening: number
  orders: number
  returns: number
  payments: number
  adjust: number
  end: number
}

/**
 * Debt breakdown per customer up to `date`, for the exported debt list.
 *
 * Unlike the original, `opening` is 0 while the opening balance is dated after `date`, so every
 * row satisfies: opening + orders + adjust - returns - payments = end (decision D-23).
 */
export function customerDebtRows(data: LedgerData, date: string): CustomerDebtRow[] {
  return data.customers.map((customer) => {
    let orders = 0
    let returns = 0
    let payments = 0
    let adjust = 0
    let opening = 0

    for (const event of eventsFor(customer.id, data)) {
      if (event.date > date) continue
      if (event.kind === KIND.OPENING) opening += event.delta
      else if (event.kind === KIND.ORDER) orders += event.delta
      else if (event.kind === KIND.RETURN) returns += -event.delta
      else if (event.kind === KIND.PAYMENT) payments += -event.delta
      else if (event.kind === KIND.ADJUST) adjust += event.delta
    }

    return {
      customer,
      opening,
      orders,
      returns,
      payments,
      adjust,
      end: balanceAt(customer.id, data, date),
    }
  })
}

/** Total value and number of orders of one customer dated in [from, to]. */
export function purchaseTotal(
  customerId: string,
  data: LedgerData,
  from: string,
  to: string,
): { total: number; count: number } {
  let total = 0
  let count = 0
  for (const order of data.orders) {
    if (order.customerId !== customerId || order.deletedAt) continue
    if (order.date < from || order.date > to) continue
    total += Number(order.total)
    count += 1
  }
  return { total, count }
}

export interface DebtSeriesPoint {
  date: string
  debt: number
  sales: number
  collected: number
}

/** Total debt, sales and collections for each of the `days` days ending at `endDate`. */
export function debtSeries(data: LedgerData, endDate: string, days: number): DebtSeriesPoint[] {
  const points: DebtSeriesPoint[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = addDays(endDate, -offset)
    const totals = dailyTotals(data, date)
    points.push({
      date,
      debt: totalDebtAt(data, date),
      sales: totals.orders,
      collected: totals.payments,
    })
  }
  return points
}
