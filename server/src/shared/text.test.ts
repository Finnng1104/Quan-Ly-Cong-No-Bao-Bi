import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, formatQty } from './format.js'
import { normalizeSearch } from './text.js'

describe('normalizeSearch', () => {
  it('lowercases and strips Vietnamese diacritics', () => {
    expect(normalizeSearch('Nguyễn Văn Ân')).toBe('nguyen van an')
    expect(normalizeSearch('Đặng Thị Hoà')).toBe('dang thi hoa')
    expect(normalizeSearch('  Cửa Hàng Minh Phát  ')).toBe('cua hang minh phat')
  })

  it('treats null and undefined as empty text', () => {
    expect(normalizeSearch(null)).toBe('')
    expect(normalizeSearch(undefined)).toBe('')
  })

  it('matches names typed with or without accents', () => {
    const stored = normalizeSearch('Chị Phượng 0901234008')

    expect(stored.includes(normalizeSearch('phuong'))).toBe(true)
    expect(stored.includes(normalizeSearch('PHƯỢNG'))).toBe(true)
    expect(stored.includes(normalizeSearch('0901'))).toBe(true)
  })
})

describe('display formatting', () => {
  it('formats money with Vietnamese thousands separators', () => {
    expect(formatMoney(12500)).toBe('12.500')
    expect(formatMoney(0)).toBe('0')
    expect(formatMoney(-2500)).toBe('-2.500')
    expect(formatMoney(null)).toBe('0')
    expect(formatMoney(Number.NaN)).toBe('0')
  })

  it('formats quantities with at most 2 decimals and a decimal comma', () => {
    expect(formatQty(1.5)).toBe('1,5')
    expect(formatQty(20)).toBe('20')
    expect(formatQty(0.333)).toBe('0,33')
    expect(formatQty(undefined)).toBe('')
  })

  it('formats dates as dd/mm/yyyy', () => {
    expect(formatDate('2026-10-11')).toBe('11/10/2026')
    expect(formatDate('2026-10-11T08:00:00.000Z')).toBe('11/10/2026')
    expect(formatDate('')).toBe('')
  })
})
