import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayBefore,
  isValidIsoDate,
  monthStart,
  oneYearBefore,
  todayInShopZone,
} from './dates.js'

describe('isValidIsoDate', () => {
  it('accepts real calendar dates, including 29 Feb in leap years', () => {
    expect(isValidIsoDate('2026-10-11')).toBe(true)
    expect(isValidIsoDate('2028-02-29')).toBe(true)
  })

  it('rejects impossible or malformed dates', () => {
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-1', '11/10/2026', '', 'abc']) {
      expect(isValidIsoDate(value), value).toBe(false)
    }
    expect(isValidIsoDate(20261011)).toBe(false)
    expect(isValidIsoDate(null)).toBe(false)
  })
})

describe('date arithmetic', () => {
  it('moves across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-10-11', -30)).toBe('2026-09-11')
    expect(dayBefore('2026-01-01')).toBe('2025-12-31')
  })

  it('finds the first day of the month', () => {
    expect(monthStart('2026-10-11')).toBe('2026-10-01')
    expect(monthStart('2026-02-28')).toBe('2026-02-01')
  })

  it('goes one year back, falling back to 28 Feb from a leap day (D-24)', () => {
    expect(oneYearBefore('2026-10-11')).toBe('2025-10-11')
    expect(oneYearBefore('2028-02-29')).toBe('2027-02-28')
    expect(oneYearBefore('2028-03-01')).toBe('2027-03-01')
  })

  it('rejects text that is not a date', () => {
    expect(() => addDays('11/10/2026', 1)).toThrowError(RangeError)
  })
})

describe('todayInShopZone', () => {
  it('uses Ho Chi Minh time (UTC+7), not the machine zone', () => {
    // 17:30 UTC on the 10th is already 00:30 on the 11th in Vietnam.
    expect(todayInShopZone(new Date('2026-10-10T17:30:00Z'))).toBe('2026-10-11')
    // 16:59 UTC is still 23:59 on the 10th.
    expect(todayInShopZone(new Date('2026-10-10T16:59:00Z'))).toBe('2026-10-10')
  })
})
