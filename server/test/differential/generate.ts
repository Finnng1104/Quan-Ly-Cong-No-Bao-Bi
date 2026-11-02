// Deterministic random ledger datasets for differential testing.
// A seeded generator means any failure can be reproduced from the seed printed in the test name.

import { addDays } from '../../src/shared/dates.js'
import { computeOrderTotals, toPriceMilli, toQtyMilli } from '../../src/shared/money.js'
import type {
  LedgerAdjustment,
  LedgerCustomer,
  LedgerData,
  LedgerOrder,
  LedgerOrderFee,
  LedgerOrderLine,
  LedgerPayment,
  LedgerReturn,
} from '../../src/modules/ledger/types.js'

export const BASE_DATE = '2026-09-01'
export const DAY_SPAN = 40

/** mulberry32: tiny, fast, good enough, and identical on every machine. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface GeneratedDataset extends LedgerData {
  adjustments: LedgerAdjustment[]
  /** Product ids and unit ids used, for building diff lookups. */
  productIds: string[]
  unitIds: string[]
}

const QUANTITIES = [0.25, 0.5, 1, 1.5, 2, 3, 5, 10, 12, 20, 0.125]
const PRICES = [300, 450, 500, 550, 1000, 7000, 12500, 18000, 25000]
const PRODUCT_IDS = ['p1', 'p2', 'p3', 'p4']
const UNIT_IDS = ['u1', 'u2', 'u3']

export function generateDataset(seed: number): GeneratedDataset {
  const random = createRng(seed)
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T
  const chance = (probability: number): boolean => random() < probability
  const dateOffset = (): string => addDays(BASE_DATE, int(0, DAY_SPAN))
  const deletedAt = (): string | null => (chance(0.1) ? '2026-10-01T00:00:00.000Z' : null)

  const customerCount = int(2, 6)
  const customers: LedgerCustomer[] = Array.from({ length: customerCount }, (_, index) => ({
    id: `c${index + 1}`,
    name: `Customer ${index + 1}`,
    phone: `09000000${index}`,
    // Some customers have no opening debt; some have one dated inside the period, which is
    // exactly where ordering and "not yet in effect" behaviour matter.
    openingDebt: chance(0.3)
      ? { amount: 0, date: dateOffset() }
      : { amount: int(1, 500) * 1000, date: addDays(BASE_DATE, int(-5, 10)) },
  }))
  const customerId = (): string => pick(customers).id

  let seq = 0
  let orderNo = 0
  const orders: LedgerOrder[] = []
  const orderCount = int(0, 25)
  for (let i = 0; i < orderCount; i++) {
    seq += 1
    orderNo += 1
    const lineCount = int(1, 4)
    const lines: LedgerOrderLine[] = Array.from({ length: lineCount }, (_, lineIndex) => ({
      id: `o${orderNo}l${lineIndex}`,
      type: chance(0.2) ? ('return' as const) : ('sell' as const),
      productId: pick(PRODUCT_IDS),
      unitId: pick(UNIT_IDS),
      qty: pick(QUANTITIES),
      price: pick(PRICES),
    }))
    const fees: LedgerOrderFee[] = chance(0.25)
      ? [{ id: `o${orderNo}f0`, name: 'Ship', amount: int(1, 50) * 1000 }]
      : []

    const useVat = chance(0.3)
    const manualVat = useVat && chance(0.4)
    const totals = computeOrderTotals({
      lines: lines.map((line) => ({
        type: line.type ?? 'sell',
        qtyMilli: toQtyMilli(line.qty),
        priceMilli: toPriceMilli(line.price),
      })),
      vat: useVat ? { rateBp: 800, amount: manualVat ? int(0, 20) * 500 : undefined } : null,
      fees,
    })

    orders.push({
      id: `o${orderNo}`,
      code: `HĐ-${String(orderNo).padStart(4, '0')}`,
      customerId: customerId(),
      date: dateOffset(),
      seq,
      total: totals.total,
      lines,
      fees,
      vat: totals.vat
        ? { rate: totals.vat.rateBp / 100, amount: totals.vat.amount, manual: totals.vat.manual }
        : null,
      editHistory: [],
      lastEditAt: null,
      deletedAt: deletedAt(),
    })
  }

  const returns: LedgerReturn[] = []
  for (let i = 0; i < int(0, 6); i++) {
    seq += 1
    const qty = pick(QUANTITIES)
    const price = pick(PRICES)
    returns.push({
      id: `r${i + 1}`,
      customerId: customerId(),
      date: dateOffset(),
      seq,
      total: Math.round(qty * price),
      lines: [{ productId: pick(PRODUCT_IDS), unitId: pick(UNIT_IDS), qty, price }],
      deletedAt: deletedAt(),
    })
  }

  const payments: LedgerPayment[] = []
  for (let i = 0; i < int(0, 10); i++) {
    seq += 1
    payments.push({
      id: `tt${i + 1}`,
      customerId: customerId(),
      date: dateOffset(),
      seq,
      amount: int(1, 200) * 1000,
      deletedAt: deletedAt(),
    })
  }

  const adjustments: LedgerAdjustment[] = []
  for (let i = 0; i < int(0, 5); i++) {
    seq += 1
    const amount = int(1, 40) * 1000 * (chance(0.5) ? 1 : -1)
    adjustments.push({
      id: `ps${i + 1}`,
      customerId: customerId(),
      date: dateOffset(),
      seq,
      amount,
      // An empty note exercises the default description.
      note: chance(0.5) ? `Adjustment ${i + 1}` : '',
      deletedAt: deletedAt(),
    })
  }

  return { customers, orders, returns, payments, adjustments, productIds: PRODUCT_IDS, unitIds: UNIT_IDS }
}

/** A few probe dates: before everything, inside the period, and after everything. */
export function probeDates(): string[] {
  return [
    addDays(BASE_DATE, -10),
    BASE_DATE,
    addDays(BASE_DATE, 7),
    addDays(BASE_DATE, 20),
    addDays(BASE_DATE, DAY_SPAN),
    addDays(BASE_DATE, DAY_SPAN + 30),
  ]
}
