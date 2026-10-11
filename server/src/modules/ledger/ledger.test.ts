// Port of the web app's src/lib/debt.test.js. Expected numbers are kept exactly as in the original.
// Tests that used mockApi.createOrder now go through computeOrderTotals, the server's single
// source of truth for what an order is worth.

import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, formatQty } from '../../shared/format.js'
import { totalsFor } from '../../../test/helpers/order.js'
import {
  balanceAt,
  balanceBeforeOrder,
  customerDebtRows,
  dailyTotals,
  diffOrders,
  eventsFor,
  ledgerRows,
  purchasedReturned,
  purchaseTotal,
  totalDebtAt,
} from './index.js'
import type { LedgerAdjustment, LedgerData, LedgerOrder } from './types.js'

const C1 = 'c1' // Thanh Nhi
const C2 = 'c2' // Ông A

function baseData(): LedgerData & { adjustments: LedgerAdjustment[] } {
  return {
    customers: [
      { id: C1, name: 'Thanh Nhi', openingDebt: { amount: 59356, date: '2026-10-01' } },
      { id: C2, name: 'Ông A', openingDebt: { amount: 0, date: '2026-10-01' } },
    ],
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
    adjustments: [],
  }
}

function firstOrder(data: LedgerData): LedgerOrder {
  const order = data.orders[0]
  if (!order) throw new Error('fixture has no order')
  return order
}

/** An order record built from the server's own totals, as the create-order endpoint will store it. */
function orderFrom(
  id: string,
  customerId: string,
  date: string,
  seq: number,
  spec: Parameters<typeof totalsFor>[0],
): LedgerOrder {
  return {
    id,
    code: `HĐ-${id}`,
    customerId,
    date,
    seq,
    total: totalsFor(spec).total,
    lines: spec.lines.map((line, index) => ({
      id: `${id}l${index}`,
      type: line.type ?? 'sell',
      productId: 'p1',
      unitId: 'u1',
      qty: line.qty,
      price: line.price,
    })),
  }
}

describe('công nợ theo kịch bản nghiệm thu', () => {
  it('Thanh Nhi: nợ đầu kỳ 59.356 + đơn 12.500 ngày 8/10 = nợ mới 71.856', () => {
    const data = baseData()
    const order = firstOrder(data)
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
    const order = firstOrder(data)
    // edit the order: 20 -> 30 (amount grows by 5.000)
    ;(order.lines[0] as { qty: number }).qty = 30
    order.total = 17500
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
    const [o1, o2] = data.orders as [LedgerOrder, LedgerOrder]
    expect(balanceBeforeOrder(C1, data, o2)).toBe(balanceBeforeOrder(C1, data, o1) + o1.total)
    expect(balanceAt(C1, data, '2026-10-08')).toBe(76856)
  })

  it('đơn ngày 5/10 sửa vào 12/10: nợ tính đến 8/10 dùng giá trị mới', () => {
    const data = baseData()
    const order = firstOrder(data)
    order.date = '2026-10-05'
    ;(order.lines[0] as { qty: number }).qty = 40 // edited later
    order.total = 22500
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
    expect(totalDebtAt(data, '2026-10-10')).toBe(
      balanceAt(C1, data, '2026-10-10') + balanceAt(C2, data, '2026-10-10'),
    )
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
    expect(opening).toBe(59356) // before 5/10 there is only the opening debt
    expect(rows).toHaveLength(2)
    expect(rows[0]?.balance).toBe(71856)
    expect(closing).toBe(41856)
  })

  it('dailyTotals tính đúng trong ngày', () => {
    const data = baseData()
    data.payments.push({ id: 'p1', customerId: C1, date: '2026-10-08', seq: 2, amount: 30000 })
    const totals = dailyTotals(data, '2026-10-08')
    expect(totals.orders).toBe(12500)
    expect(totals.orderCount).toBe(1)
    expect(totals.payments).toBe(30000)
  })
})

describe('hàng trả gộp trong phiếu bán', () => {
  it('dòng trả trừ thẳng vào tổng đơn và công nợ', () => {
    const data = baseData()
    const spec = {
      lines: [
        { qty: 20, price: 500 },
        { qty: 5, price: 500, type: 'return' as const },
      ],
    }
    const order = orderFrom('o2', C1, '2026-10-10', 2, spec)
    expect(order.total).toBe(10000 - 2500) // sell 10.000 minus return 2.500
    data.orders.push(order)
    expect(balanceAt(C1, data, '2026-10-10')).toBe(71856 + 7500)
  })

  it('purchasedReturned tính cả dòng trả trong đơn', () => {
    const data = baseData()
    const order = firstOrder(data)
    ;(order.lines[1] as { type?: 'sell' | 'return' }).type = 'return' // 5 A6 become a return line
    const map = purchasedReturned(C1, data)
    expect(map.get('p2|u1')).toEqual({ bought: 0, returned: 5 })
    expect(map.get('p1|u1')).toEqual({ bought: 20, returned: 0 })
  })
})

describe('tiền VAT hóa đơn', () => {
  it('VAT 8% tính trên hàng bán, cộng vào tổng đơn và công nợ', () => {
    const data = baseData()
    const totals = totalsFor({
      lines: [
        { qty: 10, price: 1000 },
        { qty: 2, price: 500, type: 'return' },
      ],
      vatPercent: 8,
    })
    expect(totals.vat).toEqual({ rateBp: 800, amount: 800, manual: false }) // 8% of 10.000
    expect(totals.total).toBe(10000 - 1000 + 800)

    data.orders.push({ ...orderFrom('o2', C2, '2026-10-10', 2, { lines: [] }), total: totals.total })
    expect(balanceAt(C2, data, '2026-10-10')).toBe(9800)
  })

  it('đơn không bật VAT thì không có tiền VAT', () => {
    const totals = totalsFor({ lines: [{ qty: 10, price: 1000 }] })
    expect(totals.total).toBe(10000)
    expect(totals.vat).toBeNull()
  })

  it('VAT nhập tay dùng đúng số tiền nhập, đánh dấu manual', () => {
    const totals = totalsFor({ lines: [{ qty: 10, price: 1000 }], vatPercent: 8, vatAmount: 3000 })
    expect(totals.vat).toEqual({ rateBp: 800, amount: 3000, manual: true })
    expect(totals.total).toBe(13000)
  })
})

describe('chi phí phát sinh trong đơn + tổng hàng lấy', () => {
  it('chi phí phát sinh cộng vào tổng đơn và công nợ', () => {
    const data = baseData()
    const spec = {
      lines: [{ qty: 10, price: 1000 }],
      fees: [{ amount: 30000 }, { amount: 15000 }],
    }
    const order = orderFrom('o2', C2, '2026-10-10', 2, spec)
    expect(order.total).toBe(10000 + 45000)
    data.orders.push(order)
    expect(balanceAt(C2, data, '2026-10-10')).toBe(55000)
  })

  it('bỏ qua khoản phí không dương', () => {
    const totals = totalsFor({
      lines: [{ qty: 1, price: 1000 }],
      fees: [{ amount: 500 }, { amount: 0 }, { amount: -300 }],
    })
    expect(totals.feesTotal).toBe(500)
    expect(totals.total).toBe(1500)
  })

  it('purchaseTotal đếm đơn và tổng tiền hàng trong khoảng', () => {
    const data = baseData()
    const stats = purchaseTotal(C1, data, '2026-10-05', '2026-10-10')
    expect(stats.total).toBe(12500)
    expect(stats.count).toBe(1)
    expect(purchaseTotal(C1, data, '2026-10-09', '2026-10-10').total).toBe(0)
  })
})

describe('customerDebtRows — xuất công nợ cuối', () => {
  it('bóc tách đúng nợ đầu/đơn/trả/thu/phát sinh/dư cuối', () => {
    const data = baseData()
    data.adjustments = [{ id: 'a1', customerId: C1, date: '2026-10-09', seq: 2, amount: 30000 }]
    data.payments = [{ id: 'pay1', customerId: C1, date: '2026-10-09', seq: 3, amount: 30000 }]
    const row = customerDebtRows(data, '2026-10-10').find((r) => r.customer.id === C1)
    expect(row?.opening).toBe(59356)
    expect(row?.orders).toBe(12500)
    expect(row?.returns).toBe(0)
    expect(row?.payments).toBe(30000)
    expect(row?.adjust).toBe(30000)
    expect(row?.end).toBe(59356 + 12500 - 30000 + 30000)
    // the columns add up: opening + orders + adjust - returns - payments = end
    expect((row?.opening ?? 0) + (row?.orders ?? 0) + (row?.adjust ?? 0) - (row?.returns ?? 0) - (row?.payments ?? 0)).toBe(row?.end)
  })

  // Decision D-23: the original always showed the opening balance, so a row dated before the
  // opening balance did not add up. Here the opening column only counts once it is in effect.
  it('nợ đầu kỳ chưa tới ngày thì cột nợ đầu = 0 và các cột vẫn cộng ra dư cuối', () => {
    const data = baseData()
    const row = customerDebtRows(data, '2026-09-20').find((r) => r.customer.id === C1)
    expect(row?.opening).toBe(0)
    expect(row?.end).toBe(0)
  })
})

describe('diffOrders — lịch sử điều chỉnh', () => {
  const lookups = {
    productName: (id: string) => ({ p1: 'Bao kiếng', p2: 'A6' })[id as 'p1' | 'p2'] ?? id,
    unitName: (id: string) => ({ u1: 'Cây' })[id as 'u1'] ?? id,
    customerName: (id: string) => id,
    fmtMoney: formatMoney,
    fmtQty: formatQty,
    fmtDate: formatDate,
  }

  it('ghi nhận thay đổi số lượng và chênh lệch', () => {
    const oldOrder = firstOrder(baseData())
    const next = {
      ...oldOrder,
      lines: [{ ...(oldOrder.lines[0] as LedgerOrder['lines'][number]), qty: 30 }, oldOrder.lines[1] as LedgerOrder['lines'][number]],
      total: 17500,
    }
    const result = diffOrders(oldOrder, next, lookups)
    expect(result.oldTotal).toBe(12500)
    expect(result.newTotal).toBe(17500)
    expect(result.diff).toBe(5000)
    expect(result.changes.some((change) => change.includes('SL'))).toBe(true)
  })

  it('không có thay đổi thì danh sách rỗng (để không ghi lịch sử)', () => {
    const order = firstOrder(baseData())

    expect(diffOrders(order, { ...order }, lookups).changes).toEqual([])
  })
})

describe('phát sinh công nợ tự do (tiền ship, VAT số, bớt nợ)', () => {
  it('cộng nợ tăng dư nợ, trừ nợ giảm dư nợ', () => {
    const data = baseData()
    data.adjustments = [
      { id: 'a1', customerId: C1, date: '2026-10-09', seq: 2, amount: 30000, note: 'Tiền ship' },
      { id: 'a2', customerId: C1, date: '2026-10-09', seq: 3, amount: -5000, note: 'Bớt nợ' },
    ]
    expect(balanceAt(C1, data, '2026-10-08')).toBe(71856) // not yet at the adjustment date
    expect(balanceAt(C1, data, '2026-10-09')).toBe(71856 + 30000 - 5000)
  })

  it('phát sinh hiện trong sao kê với ghi chú làm diễn giải', () => {
    const data = baseData()
    data.adjustments = [
      { id: 'a1', customerId: C1, date: '2026-10-09', seq: 2, amount: 120000, note: 'Tiền VAT hóa đơn số' },
    ]
    const { rows } = ledgerRows(C1, data, '2026-10-05', '2026-10-10')
    const adjustment = rows.find((row) => row.kind === 'adjust')
    expect(adjustment?.desc).toBe('Tiền VAT hóa đơn số')
    expect(adjustment?.up).toBe(120000)
  })
})

describe('sắp xếp phát sinh', () => {
  it('nợ đầu kỳ đứng trước cùng ngày', () => {
    const data = baseData()
    firstOrder(data).date = '2026-10-01' // same day as the opening balance
    const events = eventsFor(C1, data)
    expect(events[0]?.kind).toBe('opening')
    expect(balanceAt(C1, data, '2026-10-01')).toBe(59356 + 12500)
  })
})
