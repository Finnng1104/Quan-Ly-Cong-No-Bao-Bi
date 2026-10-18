import { describe, it, expect } from 'vitest'
import { fmtQty, parseQty } from './format'

describe('parseQty', () => {
  it('reads back the 3-decimal value the edit form fills in', () => {
    expect(parseQty('5,100')).toBe(5.1)
    expect(parseQty('1250,000')).toBe(1250)
    expect(parseQty('5.1')).toBe(5.1)
  })
})

describe('fmtQty', () => {
  it('always shows 3 decimals', () => {
    expect(fmtQty(5.1)).toBe('5,100')
    expect(fmtQty(7)).toBe('7,000')
    expect(fmtQty(5.125)).toBe('5,125')
  })

  it('keeps the thousands separator and handles empty values', () => {
    expect(fmtQty(1250.5)).toBe('1.250,500')
    expect(fmtQty('2.5')).toBe('2,500')
    expect(fmtQty(null)).toBe('')
  })
})
