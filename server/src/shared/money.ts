// Amounts (line amounts, totals, debts, payments) are always an integer number of VND. Quantities
// and unit prices are integers scaled by 1000 ("milli-units") so 1.5 is stored as 1500 and 0.25 đ
// as 250, and never go through floating point.

export const QTY_SCALE = 1000
export const PRICE_SCALE = 1000
const BP_SCALE = 10_000

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

/** Tolerance when deciding whether a JS number really has at most 3 decimal places. */
const SCALING_TOLERANCE = 1e-6

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer, got ${String(value)}`)
  }
}

/** Converts a user-facing quantity (e.g. 1.5) to milli-units (1500). Rejects more than 3 decimals. */
export function toQtyMilli(qty: number): number {
  if (!Number.isFinite(qty)) throw new MoneyError(`Quantity must be a finite number, got ${String(qty)}`)
  const scaled = qty * QTY_SCALE
  const milli = Math.round(scaled)
  if (Math.abs(scaled - milli) > SCALING_TOLERANCE) {
    throw new MoneyError(`Quantity ${String(qty)} has more than 3 decimal places`)
  }
  return milli
}

export function fromQtyMilli(milli: number): number {
  return milli / QTY_SCALE
}

/** Converts a user-facing unit price (e.g. 5250.5) to milli-units (5250500). Rejects more than 3 decimals. */
export function toPriceMilli(price: number): number {
  if (!Number.isFinite(price)) throw new MoneyError(`Price must be a finite number, got ${String(price)}`)
  const scaled = price * PRICE_SCALE
  const milli = Math.round(scaled)
  if (Math.abs(scaled - milli) > SCALING_TOLERANCE) {
    throw new MoneyError(`Price ${String(price)} has more than 3 decimal places`)
  }
  return milli
}

export function fromPriceMilli(milli: number): number {
  return milli / PRICE_SCALE
}

/**
 * `qty × price`, rounded half up to a whole VND. BigInt keeps the multiplication exact even when
 * qtyMilli × priceMilli exceeds 2^53 (e.g. 1.000.000 units × 1.000.000.000 VND).
 */
export function lineAmount(qtyMilli: number, priceMilli: number): number {
  assertSafeInteger(qtyMilli, 'qtyMilli')
  assertSafeInteger(priceMilli, 'priceMilli')
  if (qtyMilli < 0 || priceMilli < 0) throw new MoneyError('qtyMilli and priceMilli must not be negative')

  const scale = BigInt(QTY_SCALE) * BigInt(PRICE_SCALE)
  const amount = (BigInt(qtyMilli) * BigInt(priceMilli) + scale / 2n) / scale
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError('Line amount is too large')
  return Number(amount)
}

/** Percent as typed by a person (8, 5.5) to basis points (800, 550). At most 2 decimals, 0-100%. */
export function percentToBp(percent: number): number {
  if (!Number.isFinite(percent)) throw new MoneyError(`Percent must be a finite number, got ${String(percent)}`)
  const scaled = percent * 100
  const bp = Math.round(scaled)
  if (Math.abs(scaled - bp) > SCALING_TOLERANCE) {
    throw new MoneyError(`Percent ${String(percent)} has more than 2 decimal places`)
  }
  if (bp < 0 || bp > BP_SCALE) throw new MoneyError(`Percent ${String(percent)} is outside 0-100`)
  return bp
}

export function bpToPercent(bp: number): number {
  return bp / 100
}

/** VAT on the sell total, rounded half up, using integer arithmetic only. */
export function vatFromSellTotal(sellTotal: number, rateBp: number): number {
  assertSafeInteger(sellTotal, 'sellTotal')
  assertSafeInteger(rateBp, 'rateBp')
  if (sellTotal < 0) throw new MoneyError('sellTotal must not be negative')
  const half = BigInt(BP_SCALE) / 2n
  return Number((BigInt(sellTotal) * BigInt(rateBp) + half) / BigInt(BP_SCALE))
}

export type OrderLineType = 'sell' | 'return'

export interface PricedLine {
  type: OrderLineType
  qtyMilli: number
  priceMilli: number
}

export interface OrderTotalsInput {
  lines: PricedLine[]
  /**
   * `null` = no VAT. With `amount` the VAT is typed by hand and used as-is; without it the VAT
   * is computed from `rateBp` on the sell total only.
   */
  vat: { rateBp: number; amount?: number | undefined } | null
  /** Fees with a non-positive amount are ignored, like in the UI. */
  fees: { amount: number }[]
}

export interface OrderTotals {
  lineAmounts: number[]
  sellTotal: number
  returnTotal: number
  /** sellTotal - returnTotal: goods only, before VAT and fees. */
  goodsTotal: number
  vat: { rateBp: number; amount: number; manual: boolean } | null
  feesTotal: number
  total: number
}

/** Single source of truth for what an order is worth. The server never trusts totals sent by clients. */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const lineAmounts = input.lines.map((line) => lineAmount(line.qtyMilli, line.priceMilli))

  let sellTotal = 0
  let returnTotal = 0
  input.lines.forEach((line, index) => {
    const amount = lineAmounts[index] as number
    if (line.type === 'return') returnTotal += amount
    else sellTotal += amount
  })

  let vat: OrderTotals['vat'] = null
  if (input.vat) {
    const manual = input.vat.amount !== undefined
    const amount = manual
      ? Math.round(input.vat.amount as number)
      : vatFromSellTotal(sellTotal, input.vat.rateBp)
    vat = { rateBp: input.vat.rateBp, amount, manual }
  }

  const feesTotal = input.fees.reduce((sum, fee) => sum + (fee.amount > 0 ? fee.amount : 0), 0)
  const goodsTotal = sellTotal - returnTotal

  return {
    lineAmounts,
    sellTotal,
    returnTotal,
    goodsTotal,
    vat,
    feesTotal,
    total: goodsTotal + (vat?.amount ?? 0) + feesTotal,
  }
}
