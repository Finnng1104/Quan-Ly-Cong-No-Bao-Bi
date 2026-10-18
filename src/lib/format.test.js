import { describe, it, expect } from 'vitest'
import { fmtQty, parseQty } from './format'

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
