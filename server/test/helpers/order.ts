import { computeOrderTotals, toQtyMilli, type OrderTotals } from '../../src/shared/money.js'

export interface OrderLineSpec {
  type?: 'sell' | 'return'
  qty: number
  price: number
}

export interface OrderSpec {
  lines: OrderLineSpec[]
  /** Percent as typed by a person (8 = 8%). Omit for no VAT. */
  vatPercent?: number
  /** Hand-typed VAT amount; only meaningful together with `vatPercent`. */
  vatAmount?: number
  fees?: { amount: number }[]
}

/** Totals the way the server computes them for a new order, from user-facing numbers. */
export function totalsFor(spec: OrderSpec): OrderTotals {
  return computeOrderTotals({
    lines: spec.lines.map((line) => ({
      type: line.type ?? 'sell',
      qtyMilli: toQtyMilli(line.qty),
      price: line.price,
    })),
    vat:
      spec.vatPercent === undefined
        ? null
        : { rateBp: Math.round(spec.vatPercent * 100), amount: spec.vatAmount },
    fees: spec.fees ?? [],
  })
}
