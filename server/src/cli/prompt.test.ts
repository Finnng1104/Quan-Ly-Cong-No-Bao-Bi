import { describe, expect, it } from 'vitest'
import { stripByteOrderMark } from './prompt.js'

describe('stripByteOrderMark', () => {
  it('removes a leading byte order mark', () => {
    expect(stripByteOrderMark('﻿Mật-khẩu-12345')).toBe('Mật-khẩu-12345')
  })

  it('leaves text without one untouched', () => {
    expect(stripByteOrderMark('Mật-khẩu-12345')).toBe('Mật-khẩu-12345')
    expect(stripByteOrderMark('')).toBe('')
  })

  it('only strips the first one', () => {
    expect(stripByteOrderMark('﻿﻿x')).toBe('﻿x')
  })
})
