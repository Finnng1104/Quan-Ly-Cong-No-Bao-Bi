import { describe, expect, it } from 'vitest'
import { dateRangeFromSearchParams, describeDateRange } from './format'

const params = (query) => new URLSearchParams(query)

describe('dateRangeFromSearchParams', () => {
  it('reads a single day and a from/to range', () => {
    expect(dateRangeFromSearchParams(params('ngay=2026-11-09'))).toEqual({ from: '2026-11-09', to: '2026-11-09' })
    expect(dateRangeFromSearchParams(params('tu=2026-11-01&den=2026-11-09'))).toEqual({
      from: '2026-11-01',
      to: '2026-11-09',
    })
  })

  it('ignores missing, half-given or malformed dates', () => {
    expect(dateRangeFromSearchParams(params(''))).toBeNull()
    expect(dateRangeFromSearchParams(params('tu=2026-11-01'))).toBeNull()
    expect(dateRangeFromSearchParams(params('ngay=hom-nay'))).toBeNull()
  })
})

describe('describeDateRange', () => {
  it('words a single day and a range differently', () => {
    expect(describeDateRange({ from: '2026-11-09', to: '2026-11-09' })).toBe('ngày 09/11/2026')
    expect(describeDateRange({ from: '2026-11-01', to: '2026-11-09' })).toBe('từ 01/11 đến 09/11/2026')
  })
})
