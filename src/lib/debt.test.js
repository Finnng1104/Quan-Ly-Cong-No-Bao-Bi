import { describe, it, expect } from 'vitest'
import {
  balanceAt,
  balanceBeforeOrder,
  ledgerRows,
  totalDebtAt,
  dailyTotals,
  diffOrders,
  eventsFor,
  purchasedReturned,
} from './debt'
import { createOrder } from '../api/mockApi'
import { fmtMoney, fmtQty, fmtDate } from './format'

// ===== Dữ liệu kiểm thử =====
const C1 = 'c1' // Thanh Nhi
const C2 = 'c2' // Ông A

const baseData = () => ({
  customers: [
    { id: C1, name: 'Thanh Nhi', openingDebt: { amount: 59356, date: '2026-10-01' } },
    { id: C2, name: 'Ông A', openingDebt: { amount: 0, date: '2026-10-01' } },
  ],
  products: [
    { id: 'p1', name: 'Bao kiếng' },
    { id: 'p2', name: 'A6' },
  ],
  units: [{ id: 'u1', name: 'Cây' }],
  orders: [
    {
      id: 'o1',
      code: 'HĐ-0001',
      customerId: C1,
      date: '2026-10-08',
      seq: 1,
      lines: [
        { id: 'l1', productId: 'p1', unitId: 'u1', qty: 20, price: 500 },
        { id: 'l2', productId: 'p2', unitId: 'u1', qty: 5, price: 500 },
      ],
      total: 12500,
      editHistory: [],
    },
  ],
  returns: [],
  payments: [],
})

describe('công nợ theo kịch bản nghiệm thu', () => {
  it('Thanh Nhi: nợ đầu kỳ 59.356 + đơn 12.500 ngày 8/10 = nợ mới 71.856', () => {
    const data = baseData()
    const order = data.orders[0]
    expect(balanceBeforeOrder(C1, data, order)).toBe(59356)
    expect(balanceBeforeOrder(C1, data, order) + order.total).toBe(71856)
    expect(balanceAt(C1, data, '2026-10-08')).toBe(71856)
  })

  it('thanh toán 30.000 -> dư nợ 41.856', () => {
    const data = baseData()
    data.payments.push({ id: 'p1', customerId: C1, date: '2026-10-09', seq: 2, amount: 30000 })
    expect(balanceAt(C1, data, '2026-10-09')).toBe(41856)
  })

  it('sửa số lượng đơn cũ -> dư nợ các ngày sau đổi theo', () => {
    const data = baseData()
    data.payments.push({ id: 'p1', customerId: C1, date: '2026-10-09', seq: 2, amount: 30000 })
    // sửa đơn: 20 -> 30 (thành tiền tăng 5.000)
    data.orders[0].lines[0].qty = 30
    data.orders[0].total = 17500
    expect(balanceAt(C1, data, '2026-10-08')).toBe(76856)
    expect(balanceAt(C1, data, '2026-10-10')).toBe(46856)
  })

  it('nhiều đơn cùng ngày: nợ cũ đơn sau = nợ mới đơn trước', () => {
    const data = baseData()
    data.orders.push({
      id: 'o2',
      code: 'HĐ-0002',
      customerId: C1,
      date: '2026-10-08',
      seq: 2,
      lines: [{ id: 'l3', productId: 'p1', unitId: 'u1', qty: 10, price: 500 }],
      total: 5000,
    })
    const [o1, o2] = data.orders
    expect(balanceBeforeOrder(C1, data, o2)).toBe(balanceBeforeOrder(C1, data, o1) + o1.total)
    expect(balanceAt(C1, data, '2026-10-08')).toBe(76856)
  })

  it('đơn ngày 5/10 sửa vào 12/10: nợ tính đến 8/10 dùng giá trị mới', () => {
    const data = baseData()
    data.orders[0].date = '2026-10-05'
    data.orders[0].lines[0].qty = 40 // sửa sau
    data.orders[0].total = 22500
    expect(balanceAt(C1, data, '2026-10-08')).toBe(59356 + 22500)
  })

  it('tổng quan: tổng nợ = tổng dư nợ từng khách', () => {
    const data = baseData()
    data.orders.push({
      id: 'o2',
      code: 'HĐ-0002',
      customerId: C2,
      date: '2026-10-09',
      seq: 2,
      lines: [],
      total: 9000,
    })
    expect(totalDebtAt(data, '2026-10-10')).toBe(balanceAt(C1, data, '2026-10-10') + balanceAt(C2, data, '2026-10-10'))
  })

  it('hàng trả trừ công nợ', () => {
    const data = baseData()
    data.returns.push({ id: 'r1', customerId: C1, date: '2026-10-09', seq: 2, total: 2500, lines: [] })
    expect(balanceAt(C1, data, '2026-10-10')).toBe(71856 - 2500)
  })

  it('sao kê: mở đầu bằng dư đầu khoảng, cuối đúng dư nợ', () => {
    const data = baseData()
    data.payments.push({ id: 'p1', customerId: C1, date: '2026-10-09', seq: 2, amount: 30000 })
    const { opening, rows, closing } = ledgerRows(C1, data, '2026-10-05', '2026-10-10')
    expect(opening).toBe(59356) // trước 5/10 chỉ có nợ đầu kỳ
    expect(rows).toHaveLength(2)
    expect(rows[0].balance).toBe(71856)
    expect(closing).toBe(41856)
  })

  it('dailyTotals tính đúng trong ngày', () => {
    const data = baseData()
    data.payments.push({ id: 'p1', customerId: C1, date: '2026-10-08', seq: 2, amount: 30000 })
    const t = dailyTotals(data, '2026-10-08')
    expect(t.orders).toBe(12500)
    expect(t.orderCount).toBe(1)
    expect(t.payments).toBe(30000)
  })
})

describe('hàng trả gộp trong phiếu bán', () => {
  it('dòng trả trừ thẳng vào tổng đơn và công nợ', () => {
    const data = baseData()
    data.counters = { orderNo: 1, returnNo: 0, paymentNo: 0, seq: 1 }
    const { orders } = createOrder(data, {
      customerId: C1,
      date: '2026-10-10',
      lines: [
        { productId: 'p1', unitId: 'u1', qty: 20, price: 500 },
        { productId: 'p2', unitId: 'u1', qty: 5, price: 500, type: 'return' },
      ],
    })
    const order = orders.at(-1)
    expect(order.total).toBe(10000 - 2500) // bán 10.000 trừ trả 2.500
    const data2 = { ...data, orders }
    expect(balanceAt(C1, data2, '2026-10-10')).toBe(71856 + 7500)
  })

  it('purchasedReturned tính cả dòng trả trong đơn', () => {
    const data = baseData()
    data.orders[0].lines[1].type = 'return' // 5 A6 thành dòng trả
    const map = purchasedReturned(C1, data)
    expect(map.get('p2|u1')).toEqual({ bought: 0, returned: 5 })
    expect(map.get('p1|u1')).toEqual({ bought: 20, returned: 0 })
  })
})

describe('tiền VAT hóa đơn', () => {
  it('VAT 8% tính trên hàng bán, cộng vào tổng đơn và công nợ', () => {
    const data = baseData()
    data.counters = { orderNo: 1, returnNo: 0, paymentNo: 0, seq: 1 }
    const { orders } = createOrder(data, {
      customerId: C2,
      date: '2026-10-10',
      lines: [
        { productId: 'p1', unitId: 'u1', qty: 10, price: 1000 },
        { productId: 'p2', unitId: 'u1', qty: 2, price: 500, type: 'return' },
      ],
      vat: true,
      vatRate: 8,
    })
    const order = orders.at(-1)
    expect(order.vat).toEqual({ rate: 8, amount: 800 }) // 8% của 10.000
    expect(order.total).toBe(10000 - 1000 + 800)
    const data2 = { ...data, orders }
    expect(balanceAt(C2, data2, '2026-10-10')).toBe(9800)
  })

  it('đơn không bật VAT thì không có tiền VAT', () => {
    const data = baseData()
    data.counters = { orderNo: 1, returnNo: 0, paymentNo: 0, seq: 1 }
    const { orders } = createOrder(data, {
      customerId: C2,
      date: '2026-10-10',
      lines: [{ productId: 'p1', unitId: 'u1', qty: 10, price: 1000 }],
      vat: false,
      vatRate: 8,
    })
    expect(orders.at(-1).total).toBe(10000)
    expect(orders.at(-1).vat).toBeNull()
  })
})

describe('diffOrders — lịch sử điều chỉnh', () => {
  const lookups = {
    productName: (id) => ({ p1: 'Bao kiếng', p2: 'A6' })[id] || id,
    unitName: (id) => ({ u1: 'Cây' })[id] || id,
    customerName: (id) => id,
    fmtMoney,
    fmtQty,
    fmtDate,
  }

  it('ghi nhận thay đổi số lượng và chênh lệch', () => {
    const data = baseData()
    const oldOrder = data.orders[0]
    const next = {
      ...oldOrder,
      lines: [
        { ...oldOrder.lines[0], qty: 30 },
        oldOrder.lines[1],
      ],
      total: 17500,
    }
    const d = diffOrders(oldOrder, next, lookups)
    expect(d.oldTotal).toBe(12500)
    expect(d.newTotal).toBe(17500)
    expect(d.diff).toBe(5000)
    expect(d.changes.some((c) => c.includes('SL'))).toBe(true)
  })
})

describe('sắp xếp phát sinh', () => {
  it('nợ đầu kỳ đứng trước cùng ngày', () => {
    const data = baseData()
    data.orders[0].date = '2026-10-01' // cùng ngày nợ đầu kỳ
    const evs = eventsFor(C1, data)
    expect(evs[0].kind).toBe('opening')
    expect(balanceAt(C1, data, '2026-10-01')).toBe(59356 + 12500)
  })
})
