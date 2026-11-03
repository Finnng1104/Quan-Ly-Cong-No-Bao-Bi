import { describe, it, expect } from 'vitest'
import { appendUniqueById, sameDeps } from './pagedList'

describe('appendUniqueById', () => {
  it('appends the next page after the current rows', () => {
    expect(appendUniqueById([{ id: 1 }, { id: 2 }], [{ id: 3 }])).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('skips rows that shifted into the next page and were already loaded', () => {
    expect(appendUniqueById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ])
  })

  it('returns the same array when the page adds nothing new', () => {
    const current = [{ id: 1 }]
    expect(appendUniqueById(current, [{ id: 1 }])).toBe(current)
    expect(appendUniqueById(current, [])).toBe(current)
  })
})

describe('sameDeps', () => {
  it('is false before the first run', () => {
    expect(sameDeps(null, ['a'])).toBe(false)
  })

  it('compares values one by one', () => {
    expect(sameDeps(['a', 1], ['a', 1])).toBe(true)
    expect(sameDeps(['a', 1], ['a', 2])).toBe(false)
    expect(sameDeps(['a'], ['a', 'b'])).toBe(false)
  })
})
