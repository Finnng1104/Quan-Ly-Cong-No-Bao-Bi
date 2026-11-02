import { describe, it, expect } from 'vitest'
import {
  fmtPrice,
  formatPriceInput,
  fmtQty,
  parsePrice,
  parseQty,
  priceToInput,
  sanitizePriceInput,
} from './format'

describe('fmtQty', () => {
  it('drops trailing zeros', () => {
    expect(fmtQty(5.1)).toBe('5,1')
    expect(fmtQty(7)).toBe('7')
  })

  it('keeps all 3 stored decimals instead of rounding them away', () => {
    expect(fmtQty(5.125)).toBe('5,125')
  })

  it('keeps the thousands separator and handles empty values', () => {
    expect(fmtQty(1250.5)).toBe('1.250,5')
    expect(fmtQty('2.5')).toBe('2,5')
    expect(fmtQty(null)).toBe('')
  })
})

describe('parseQty', () => {
  it('accepts both a comma and a dot as the decimal mark', () => {
    expect(parseQty('5,1')).toBe(5.1)
    expect(parseQty('5.1')).toBe(5.1)
    expect(parseQty('')).toBe(0)
  })
})

describe('unit price input', () => {
  it('shows thousand dots and keeps a comma as the decimal mark', () => {
    expect(fmtPrice(5250)).toBe('5.250')
    expect(fmtPrice(0.5)).toBe('0,5')
    expect(fmtPrice(5250.75)).toBe('5.250,75')
    expect(fmtPrice(null)).toBe('0')
  })

  it('cleans typed text: digits and one comma, at most 3 decimals', () => {
    expect(sanitizePriceInput('5.250')).toBe('5250')
    expect(sanitizePriceInput('5250,5')).toBe('5250,5')
    expect(sanitizePriceInput('1,2,3')).toBe('1,23')
    expect(sanitizePriceInput('1,23456')).toBe('1,234')
    expect(sanitizePriceInput('abc')).toBe('')
  })

  it('formats while typing without losing a trailing comma', () => {
    expect(formatPriceInput('')).toBe('')
    expect(formatPriceInput('1500000')).toBe('1.500.000')
    expect(formatPriceInput('5250,')).toBe('5.250,')
    expect(formatPriceInput('5250,50')).toBe('5.250,50')
    expect(formatPriceInput(',5')).toBe('0,5')
  })

  it('converts between server numbers and input text', () => {
    expect(priceToInput(5250.5)).toBe('5250,5')
    expect(priceToInput(500)).toBe('500')
    expect(parsePrice('5250,5')).toBe(5250.5)
    expect(parsePrice('')).toBe(0)
  })
})
