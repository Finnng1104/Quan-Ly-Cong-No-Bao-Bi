import { describe, expect, it } from 'vitest'
import {
  bpToPercent,
  computeOrderTotals,
  fromQtyMilli,
  lineAmount,
  MoneyError,
  percentToBp,
  toQtyMilli,
  vatFromSellTotal,
} from './money.js'

describe('toQtyMilli / fromQtyMilli', () => {
  it('scales quantities with up to 3 decimals exactly', () => {
    expect(toQtyMilli(1)).toBe(1000)
    expect(toQtyMilli(0.5)).toBe(500)
    expect(toQtyMilli(1.5)).toBe(1500)
    expect(toQtyMilli(0.001)).toBe(1)
    // 1.005 * 1000 is 1004.9999999999999 in floating point; it must still become 1005.
    expect(toQtyMilli(1.005)).toBe(1005)
    expect(toQtyMilli(0.1 + 0.2)).toBe(300)
    expect(fromQtyMilli(1500)).toBe(1.5)
  })

  it('rejects more than 3 decimals and non-finite numbers', () => {
    expect(() => toQtyMilli(1.0005)).toThrowError(MoneyError)
    expect(() => toQtyMilli(Number.NaN)).toThrowError(MoneyError)
    expect(() => toQtyMilli(Number.POSITIVE_INFINITY)).toThrowError(MoneyError)
  })
})

describe('lineAmount', () => {
  it('multiplies qty by price in whole VND', () => {
    expect(lineAmount(20_000, 500)).toBe(10_000)
    expect(lineAmount(1_500, 18_000)).toBe(27_000)
    expect(lineAmount(500, 32_000)).toBe(16_000)
  })

  it('rounds half up, even where floating point would round down', () => {
    // 1,005 × 100 = 100,5 exactly. Math.round(1.005 * 100) gives 100 because 1.005*100 = 100.49999999999999.
    expect(lineAmount(1_005, 100)).toBe(101)
    expect(lineAmount(500, 1)).toBe(1) // 0,5 -> 1
    expect(lineAmount(499, 1)).toBe(0) // 0,499 -> 0
    expect(lineAmount(1_500, 1)).toBe(2) // 1,5 -> 2
  })

  it('stays exact when the product exceeds 2^53', () => {
    // 1.000.000 units × 1.000.000.000 VND = 10^15, but qtyMilli × price = 10^18.
    expect(lineAmount(1_000_000_000, 1_000_000_000)).toBe(1_000_000_000_000_000)
  })

  it('rejects fractional or negative inputs and amounts beyond safe integers', () => {
    expect(() => lineAmount(1.5, 100)).toThrowError(MoneyError)
    expect(() => lineAmount(1000, 10.5)).toThrowError(MoneyError)
    expect(() => lineAmount(-1, 100)).toThrowError(MoneyError)
    expect(() => lineAmount(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrowError(MoneyError)
  })
})

describe('percent <-> basis points', () => {
  it('converts typed percentages', () => {
    expect(percentToBp(8)).toBe(800)
    expect(percentToBp(5.5)).toBe(550)
    expect(percentToBp(0)).toBe(0)
    expect(percentToBp(100)).toBe(10_000)
    expect(bpToPercent(800)).toBe(8)
  })

  it('rejects more than 2 decimals and out-of-range values', () => {
    expect(() => percentToBp(8.005)).toThrowError(MoneyError)
    expect(() => percentToBp(-1)).toThrowError(MoneyError)
    expect(() => percentToBp(100.01)).toThrowError(MoneyError)
  })
})

describe('vatFromSellTotal', () => {
  it('computes 8% and rounds half up', () => {
    expect(vatFromSellTotal(10_000, 800)).toBe(800)
    expect(vatFromSellTotal(132_000, 800)).toBe(10_560)
    expect(vatFromSellTotal(1_250, 800)).toBe(100)
    expect(vatFromSellTotal(10, 500)).toBe(1) // 0,5 -> 1
    expect(vatFromSellTotal(0, 800)).toBe(0)
  })

  it('agrees with the web app (Math.round on floats) for every 8% amount in a wide range', () => {
    // Fractional part of n × 0.08 is a multiple of 0.04, so it never sits near .5 and the two
    // methods cannot disagree. Checked exhaustively instead of trusted.
    for (let sellTotal = 0; sellTotal <= 200_000; sellTotal++) {
      const webApp = Math.round(sellTotal * (8 / 100))
      expect(vatFromSellTotal(sellTotal, 800), String(sellTotal)).toBe(webApp)
    }
  })
})

describe('computeOrderTotals', () => {
  const sell = (qtyMilli: number, price: number) => ({ type: 'sell' as const, qtyMilli, price })
  const back = (qtyMilli: number, price: number) => ({ type: 'return' as const, qtyMilli, price })

  it('subtracts return lines and computes VAT on sold goods only', () => {
    const totals = computeOrderTotals({
      lines: [sell(10_000, 1_000), back(2_000, 500)],
      vat: { rateBp: 800 },
      fees: [],
    })

    expect(totals.sellTotal).toBe(10_000)
    expect(totals.returnTotal).toBe(1_000)
    expect(totals.goodsTotal).toBe(9_000)
    expect(totals.vat).toEqual({ rateBp: 800, amount: 800, manual: false })
    expect(totals.total).toBe(9_800)
  })

  it('uses a hand-typed VAT amount as is and marks it manual', () => {
    const totals = computeOrderTotals({
      lines: [sell(10_000, 1_000)],
      vat: { rateBp: 800, amount: 3_000 },
      fees: [],
    })

    expect(totals.vat).toEqual({ rateBp: 800, amount: 3_000, manual: true })
    expect(totals.total).toBe(13_000)
  })

  it('adds fees and ignores non-positive ones', () => {
    const totals = computeOrderTotals({
      lines: [sell(1_000, 10_000)],
      vat: null,
      fees: [{ amount: 30_000 }, { amount: 0 }, { amount: -5 }],
    })

    expect(totals.feesTotal).toBe(30_000)
    expect(totals.total).toBe(40_000)
    expect(totals.vat).toBeNull()
  })

  it('can be negative when returns exceed sales', () => {
    const totals = computeOrderTotals({ lines: [back(1_000, 2_500)], vat: null, fees: [] })

    expect(totals.total).toBe(-2_500)
  })
})
