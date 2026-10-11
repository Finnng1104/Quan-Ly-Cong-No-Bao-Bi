// Port of the web app's src/lib/seed.test.js: integration checks on the real demo dataset.

import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../../test/fixtures/seed.js'
import { todayInShopZone } from '../../shared/dates.js'
import { balanceAt, balanceBeforeOrder, totalDebtAt } from './index.js'

describe('dữ liệu mẫu khớp kịch bản nghiệm thu', () => {
  const today = todayInShopZone()
  const data = buildSeed(today)

  const orderByCode = (code: string) => {
    const order = data.orders.find((candidate) => candidate.code === code)
    if (!order) throw new Error(`seed has no order ${code}`)
    return order
  }

  it('phiếu HĐ-0001 của Thanh Nhi: tổng 12.500, nợ cũ 59.356, nợ mới 71.856', () => {
    const order = orderByCode('HĐ-0001')
    expect(order.customerId).toBe('c01')
    expect(order.total).toBe(12500)
    expect(balanceBeforeOrder('c01', data, order)).toBe(59356)
    expect(balanceBeforeOrder('c01', data, order) + order.total).toBe(71856)
  })

  it('hai đơn ông A cùng ngày: nợ cũ đơn sau = nợ mới đơn trước', () => {
    const order6 = orderByCode('HĐ-0006')
    const order7 = orderByCode('HĐ-0007')
    expect(order6.date).toBe(order7.date)
    expect(balanceBeforeOrder('c02', data, order7)).toBe(
      balanceBeforeOrder('c02', data, order6) + order6.total,
    )
  })

  it('tổng nợ toàn cục = tổng dư nợ từng khách', () => {
    const sum = data.customers.reduce((total, c) => total + balanceAt(c.id, data, today), 0)
    expect(totalDebtAt(data, today)).toBe(sum)
  })

  it('đơn HĐ-0010 của Chị Hoa được đánh dấu sửa sau sao kê gần nhất', () => {
    const lastExport = data.statementExports.filter((x) => x.customerId === 'c03').at(-1)
    const order = orderByCode('HĐ-0010')
    expect((order.lastEditAt ?? '') > (lastExport?.exportedAt ?? '')).toBe(true)
    expect(order.editHistory?.[0]?.diff).toBe(5500)
  })

  it('đổi bảng giá sau lập đơn không làm đổi đơn cũ (giá lưu cứng trong dòng)', () => {
    const order = orderByCode('HĐ-0001')
    const totalBefore = order.total
    const price = data.priceBook.find((entry) => entry.id === 'pb1')
    if (price) price.price = 99999
    expect(order.total).toBe(totalBefore)
    expect(balanceAt('c01', data, today)).toBeGreaterThan(0)
  })
})
