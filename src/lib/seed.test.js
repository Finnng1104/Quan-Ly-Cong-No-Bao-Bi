import { describe, it, expect } from 'vitest'
import { buildSeed } from '../data/mockData'
import { balanceBeforeOrder, balanceAt, totalDebtAt } from './debt'
import { todayISO } from './format'

// Kiểm thử tích hợp trên dữ liệu mẫu thật
describe('dữ liệu mẫu khớp kịch bản nghiệm thu', () => {
  const d = buildSeed()
  const today = todayISO()

  it('phiếu HĐ-0001 của Thanh Nhi: tổng 12.500, nợ cũ 59.356, nợ mới 71.856', () => {
    const order = d.orders.find((o) => o.code === 'HĐ-0001')
    expect(order.customerId).toBe('c01')
    expect(order.total).toBe(12500)
    expect(balanceBeforeOrder('c01', d, order)).toBe(59356)
    expect(balanceBeforeOrder('c01', d, order) + order.total).toBe(71856)
  })

  it('hai đơn ông A cùng ngày: nợ cũ đơn sau = nợ mới đơn trước', () => {
    const o6 = d.orders.find((o) => o.code === 'HĐ-0006')
    const o7 = d.orders.find((o) => o.code === 'HĐ-0007')
    expect(o6.date).toBe(o7.date)
    expect(balanceBeforeOrder('c02', d, o7)).toBe(balanceBeforeOrder('c02', d, o6) + o6.total)
  })

  it('tổng nợ toàn cục = tổng dư nợ từng khách', () => {
    const sum = d.customers.reduce((s, c) => s + balanceAt(c.id, d, today), 0)
    expect(totalDebtAt(d, today)).toBe(sum)
  })

  it('đơn HĐ-0010 của Chị Hoa được đánh dấu sửa sau sao kê gần nhất', () => {
    const lastEx = d.statementExports.filter((x) => x.customerId === 'c03').at(-1)
    const o10 = d.orders.find((o) => o.code === 'HĐ-0010')
    expect(o10.lastEditAt > lastEx.exportedAt).toBe(true)
    expect(o10.editHistory[0].diff).toBe(5500)
  })

  it('đổi bảng giá sau lập đơn không làm đổi đơn cũ (giá lưu cứng trong dòng)', () => {
    const order = d.orders.find((o) => o.code === 'HĐ-0001')
    const oldTotal = order.total
    // giả lập đổi bảng giá
    d.priceBook.find((p) => p.id === 'pb1').price = 99999
    expect(order.total).toBe(oldTotal)
    expect(balanceAt('c01', d, today)).toBeGreaterThan(0)
  })
})
