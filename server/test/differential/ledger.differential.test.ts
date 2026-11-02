// Differential test: the TypeScript ledger must agree with the web app's original src/lib/debt.js
// on the same data. The original is the oracle; every deliberate difference is asserted below
// as a difference, so nothing diverges silently.

import { describe, expect, it } from 'vitest'
import * as reference from '../../../src/lib/debt.js'
import * as referenceFormat from '../../../src/lib/format.js'
import * as ledger from '../../src/modules/ledger/index.js'
import { addDays, oneYearBefore } from '../../src/shared/dates.js'
import { formatDate, formatMoney, formatQty } from '../../src/shared/format.js'
import { normalizeSearch } from '../../src/shared/text.js'
import { BASE_DATE, createRng, DAY_SPAN, generateDataset, probeDates } from './generate.js'

const SEEDS = Array.from({ length: 150 }, (_, index) => 1_000 + index)

// The oracle is plain JS, so its parameter and return types are whatever TypeScript inferred.
// Casting once here keeps every assertion below readable.
type Anything = any
const ref = reference as unknown as Record<string, (...args: Anything[]) => Anything>

describe('ledger vs original debt.js on random datasets', () => {
  it.each(SEEDS)('seed %i: balances, events and aggregates are identical', (seed) => {
    const data = generateDataset(seed)

    for (const customer of data.customers) {
      expect(ledger.eventsFor(customer.id, data), `events of ${customer.id}`).toEqual(
        ref.eventsFor?.(customer.id, data),
      )

      for (const date of probeDates()) {
        expect(ledger.balanceAt(customer.id, data, date), `balanceAt ${customer.id} ${date}`).toBe(
          ref.balanceAt?.(customer.id, data, date),
        )
      }

      for (const order of data.orders) {
        expect(
          ledger.balanceBeforeOrder(customer.id, data, order),
          `balanceBeforeOrder ${customer.id} ${order.id}`,
        ).toBe(ref.balanceBeforeOrder?.(customer.id, data, order))
      }

      expect(ledger.fullLedger(customer.id, data), `fullLedger ${customer.id}`).toEqual(
        ref.fullLedger?.(customer.id, data),
      )
      expect(ledger.fullLedger(customer.id, data, addDays(BASE_DATE, 15))).toEqual(
        ref.fullLedger?.(customer.id, data, addDays(BASE_DATE, 15)),
      )

      const from = addDays(BASE_DATE, 5)
      const to = addDays(BASE_DATE, 25)
      expect(ledger.ledgerRows(customer.id, data, from, to), `ledgerRows ${customer.id}`).toEqual(
        ref.ledgerRows?.(customer.id, data, from, to),
      )

      expect(ledger.purchaseTotal(customer.id, data, from, to)).toEqual(
        ref.purchaseTotal?.(customer.id, data, from, to),
      )
    }

    for (const date of probeDates()) {
      expect(ledger.debtsByCustomer(data, date), `debtsByCustomer ${date}`).toEqual(
        ref.debtsByCustomer?.(data, date),
      )
      expect(ledger.totalDebtAt(data, date)).toBe(ref.totalDebtAt?.(data, date))
      expect(ledger.dayActivitiesByCustomer(data, date)).toEqual(ref.dayActivitiesByCustomer?.(data, date))
      expect(ledger.dailyTotals(data, date)).toEqual(ref.dailyTotals?.(data, date))
      expect(ledger.rangeTotals(data, BASE_DATE, date)).toEqual(ref.rangeTotals?.(data, BASE_DATE, date))
    }

    const endDate = addDays(BASE_DATE, DAY_SPAN)
    expect(ledger.debtSeries(data, endDate, 14)).toEqual(
      ref.debtSeries?.(data, endDate, 14, addDays),
    )
  })

  it.each(SEEDS)('seed %i: purchased/returned quantities agree (decimals within 1e-9)', (seed) => {
    const data = generateDataset(seed)

    for (const customer of data.customers) {
      const ours = ledger.purchasedReturned(customer.id, data)
      const theirs = ref.purchasedReturned?.(customer.id, data) as Map<string, { bought: number; returned: number }>

      expect([...ours.keys()].sort()).toEqual([...theirs.keys()].sort())
      for (const [key, value] of ours) {
        const expected = theirs.get(key)
        expect(Math.abs(value.bought - (expected?.bought ?? 0)), `${key} bought`).toBeLessThan(1e-9)
        expect(Math.abs(value.returned - (expected?.returned ?? 0)), `${key} returned`).toBeLessThan(1e-9)
      }
    }
  })

  // The one function that intentionally differs (decision D-23).
  it.each(SEEDS)('seed %i: debt rows differ only in the opening column, and only by design', (seed) => {
    const data = generateDataset(seed)

    for (const date of probeDates()) {
      const ours = ledger.customerDebtRows(data, date)
      const theirs = ref.customerDebtRows?.(data, date) as typeof ours

      expect(ours).toHaveLength(theirs.length)
      ours.forEach((row, index) => {
        const original = theirs[index]
        if (!original) throw new Error('row count mismatch')
        const { opening, ...rest } = row
        const { opening: originalOpening, ...originalRest } = original
        expect(rest).toEqual(originalRest)

        const openingDate = row.customer.openingDebt?.date ?? ''
        const inEffect = openingDate <= date
        expect(opening).toBe(inEffect ? originalOpening : 0)

        // The invariant the original could not guarantee:
        expect(row.opening + row.orders + row.adjust - row.returns - row.payments).toBe(row.end)
      })
    }
  })
})

describe('shared helpers vs the web app', () => {
  it('normalizeSearch matches the web app normalize()', () => {
    const samples = [
      'Nguyễn Văn Ân',
      'ĐẶNG THỊ HOÀ',
      'Cửa hàng Minh Phát 0901234010',
      '  spaces  ',
      'Ông A (Nguyễn Văn An)',
      'đ Đ ê Ê ơ Ơ ư Ư',
      '',
    ]
    for (const sample of samples) {
      expect(normalizeSearch(sample), sample).toBe(referenceFormat.normalize(sample))
    }
  })

  it('money, quantity and date formatting match the web app', () => {
    for (const value of [0, 1, 999, 1000, 12500, 1234567, -2500, 0.4, 1234.5]) {
      expect(formatMoney(value), `money ${value}`).toBe(referenceFormat.fmtMoney(value))
    }
    for (const value of [0, 1, 1.5, 0.5, 0.333, 0.125, 20, 1234.567]) {
      expect(formatQty(value), `qty ${value}`).toBe(referenceFormat.fmtQty(value))
    }
    for (const value of ['2026-10-11', '2026-01-02T08:00:00.000Z', '']) {
      expect(formatDate(value), `date ${value}`).toBe(referenceFormat.fmtDate(value))
    }
    expect(formatMoney(null)).toBe(referenceFormat.fmtMoney(null))
    expect(formatQty(null)).toBe(referenceFormat.fmtQty(null))
  })

  it('date arithmetic matches the web app away from DST, and fixes its 12-month window', () => {
    for (const date of ['2026-10-31', '2026-12-31', '2028-02-28', '2026-03-01']) {
      expect(addDays(date, 1)).toBe(referenceFormat.addDaysISO(date, 1))
      expect(addDays(date, -45)).toBe(referenceFormat.addDaysISO(date, -45))
    }
    // The statement page used `new Date(...).setFullYear(...)` + toISOString(), which in a UTC+7
    // timezone lands one day early. The server defines the window explicitly instead.
    expect(oneYearBefore('2026-10-11')).toBe('2025-10-11')
  })
})

describe('order totals vs the web app (mockApi.createOrder)', () => {
  // The web app computes with floating point; the server with integers. This test measures how
  // far apart they can be instead of assuming they never differ.
  it('stays within a few VND, differing only where floating point rounds a .5 down', async () => {
    const { createOrder } = await import('../../../src/api/mockApi.js')
    const { computeOrderTotals, toPriceMilli, toQtyMilli } = await import('../../src/shared/money.js')

    const random = createRng(424_242)
    const quantities = [0.125, 0.25, 0.5, 1, 1.005, 1.5, 2.125, 3, 10, 12.75, 0.333]
    let compared = 0
    const mismatches: string[] = []

    for (let i = 0; i < 2_000; i++) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({
        type: random() < 0.2 ? ('return' as const) : ('sell' as const),
        qty: quantities[Math.floor(random() * quantities.length)] as number,
        price: 100 + Math.floor(random() * 30_000),
      }))
      const useVat = random() < 0.5
      const fees = random() < 0.3 ? [{ amount: 1000 * (1 + Math.floor(random() * 30)) }] : []

      const state = {
        counters: { orderNo: 0, returnNo: 0, paymentNo: 0, seq: 0 },
        orders: [],
      }
      const created = createOrder(state as Anything, {
        customerId: 'c1',
        date: '2026-10-11',
        lines: lines.map((line) => ({ productId: 'p1', unitId: 'u1', ...line })),
        vat: useVat,
        vatRate: 8,
        fees,
      } as Anything)
      const original = created._created as { total: number }

      const ours = computeOrderTotals({
        lines: lines.map((line) => ({ type: line.type, qtyMilli: toQtyMilli(line.qty), priceMilli: toPriceMilli(line.price) })),
        vat: useVat ? { rateBp: 800 } : null,
        fees,
      })

      compared += 1
      const delta = ours.total - original.total
      // Each line can be off by 1 VND at most, so the total is off by at most one per line.
      expect(Math.abs(delta), JSON.stringify({ lines, useVat, fees })).toBeLessThanOrEqual(lines.length)
      if (delta !== 0) mismatches.push(JSON.stringify({ delta, lines, useVat }))
    }

    // Documented, not hidden: how often the two methods disagree on this sample.
    console.info(`order totals: ${compared} compared, ${mismatches.length} differ by float rounding`)
    expect(compared).toBe(2_000)
  })
})
