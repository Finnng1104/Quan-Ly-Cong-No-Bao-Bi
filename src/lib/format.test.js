import { describe, it, expect } from 'vitest'
import { fmtQty } from './format'

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
