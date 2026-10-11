// Port of the web app's src/data/mockData.js, with "today" passed in so tests are deterministic.
// Used to prove the server's ledger code agrees with the acceptance scenarios of the UI.

import { addDays } from '../../src/shared/dates.js'
import type {
  LedgerAdjustment,
  LedgerCustomer,
  LedgerData,
  LedgerOrder,
  LedgerPayment,
  LedgerReturn,
} from '../../src/modules/ledger/types.js'

export interface SeedData extends LedgerData {
  customers: LedgerCustomer[]
  products: { id: string; name: string }[]
  units: { id: string; name: string }[]
  priceBook: { id: string; customerId: string; productId: string; unitId: string; price: number }[]
  statementExports: { id: string; customerId: string; from: string; to: string; exportedAt: string }[]
  adjustments: LedgerAdjustment[]
  counters: { orderNo: number; returnNo: number; paymentNo: number; adjustNo: number; seq: number }
}

type OrderSpecLine = [productId: string, unitId: string, qty: number, price: number, type?: 'return']
type OrderSpec = [customerId: string, daysAgo: number, lines: OrderSpecLine[]]

export function buildSeed(today: string): SeedData {
  // d(n) = the date n days ago
  const d = (n: number): string => addDays(today, -n)
  // ts(n, h, m) = a local timestamp n days ago. No "Z" on purpose, like the original seed.
  const ts = (n: number, h = 10, m = 0): string =>
    `${d(n)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`

  const opening = (amount: number): LedgerCustomer['openingDebt'] => ({ amount, date: d(30) })
  const customers: LedgerCustomer[] = [
    { id: 'c01', name: 'Thanh Nhi', phone: '0901234001', openingDebt: opening(59356) },
    { id: 'c02', name: 'Ông A (Nguyễn Văn An)', phone: '0901234002', openingDebt: opening(120000) },
    { id: 'c03', name: 'Chị Hoa', phone: '0901234003', openingDebt: opening(45000) },
    { id: 'c04', name: 'Anh Tuấn', phone: '0901234004', openingDebt: opening(0) },
    { id: 'c05', name: 'Cô Lan', phone: '0901234005', openingDebt: opening(210500) },
    { id: 'c06', name: 'Bác Sáu', phone: '0901234006', openingDebt: opening(88000) },
    { id: 'c07', name: 'Quán Cơm Bình Dân', phone: '0901234007', openingDebt: opening(0) },
    { id: 'c08', name: 'Chị Phượng', phone: '0901234008', openingDebt: opening(34000) },
    { id: 'c09', name: 'Anh Khoa', phone: '0901234009', openingDebt: opening(0) },
    { id: 'c10', name: 'Cửa hàng Minh Phát', phone: '0901234010', openingDebt: opening(500000) },
    { id: 'c11', name: 'Chị Nga', phone: '0901234011', openingDebt: opening(15000) },
    { id: 'c12', name: 'Anh Dũng', phone: '0901234012', openingDebt: opening(0) },
    { id: 'c13', name: 'Cô Tư', phone: '0901234013', openingDebt: opening(76000) },
    { id: 'c14', name: 'Chị Yến', phone: '0901234014', openingDebt: opening(0) },
    { id: 'c15', name: 'Anh Phúc', phone: '0901234015', openingDebt: opening(0) },
  ]

  const products = [
    { id: 'p1', name: 'Bao kiếng' },
    { id: 'p2', name: 'Giấy A6' },
    { id: 'p3', name: 'Bao nylon' },
    { id: 'p4', name: 'Băng keo trong' },
    { id: 'p5', name: 'Thùng carton 40x30' },
    { id: 'p6', name: 'Túi zip 15x22' },
    { id: 'p7', name: 'Giấy gói hàng' },
    { id: 'p8', name: 'Dây thun buộc' },
    { id: 'p9', name: 'Màng PE quấn' },
  ]

  const units = [
    { id: 'u1', name: 'Cây' },
    { id: 'u2', name: 'Tệp' },
    { id: 'u3', name: 'Cuộn' },
    { id: 'u4', name: 'Cái' },
    { id: 'u5', name: 'Kg' },
    { id: 'u6', name: 'Cặp' },
  ]

  const priceBook: SeedData['priceBook'] = [
    { id: 'pb1', customerId: 'c01', productId: 'p1', unitId: 'u1', price: 500 },
    { id: 'pb2', customerId: 'c01', productId: 'p2', unitId: 'u2', price: 500 },
    { id: 'pb3', customerId: 'c01', productId: 'p3', unitId: 'u5', price: 25000 },
    { id: 'pb4', customerId: 'c01', productId: 'p4', unitId: 'u3', price: 8000 },
    { id: 'pb5', customerId: 'c02', productId: 'p1', unitId: 'u1', price: 600 },
    { id: 'pb6', customerId: 'c02', productId: 'p2', unitId: 'u2', price: 550 },
    { id: 'pb7', customerId: 'c02', productId: 'p5', unitId: 'u4', price: 12000 },
    { id: 'pb8', customerId: 'c03', productId: 'p1', unitId: 'u1', price: 550 },
    { id: 'pb9', customerId: 'c03', productId: 'p6', unitId: 'u2', price: 15000 },
    { id: 'pb10', customerId: 'c03', productId: 'p9', unitId: 'u3', price: 45000 },
    { id: 'pb11', customerId: 'c10', productId: 'p1', unitId: 'u1', price: 450 },
    { id: 'pb12', customerId: 'c10', productId: 'p2', unitId: 'u2', price: 420 },
    { id: 'pb13', customerId: 'c10', productId: 'p3', unitId: 'u5', price: 22000 },
    { id: 'pb14', customerId: 'c10', productId: 'p4', unitId: 'u3', price: 7000 },
    { id: 'pb15', customerId: 'c10', productId: 'p5', unitId: 'u4', price: 10000 },
    { id: 'pb16', customerId: 'c05', productId: 'p7', unitId: 'u5', price: 18000 },
    { id: 'pb17', customerId: 'c05', productId: 'p8', unitId: 'u5', price: 30000 },
  ]

  const orderSpecs: OrderSpec[] = [
    ['c01', 2, [['p1', 'u1', 20, 500], ['p2', 'u2', 5, 500]]], // acceptance order: 12.500
    ['c01', 6, [['p3', 'u5', 2, 25000]]],
    ['c01', 0, [['p4', 'u3', 3, 8000], ['p1', 'u1', 10, 500]]],
    ['c02', 9, [['p1', 'u1', 50, 600]]],
    ['c02', 7, [['p5', 'u4', 10, 12000], ['p2', 'u2', 8, 550]]],
    ['c02', 3, [['p1', 'u1', 30, 600]]],
    ['c02', 3, [['p2', 'u2', 12, 550]]], // same day, later order
    ['c02', 1, [['p4', 'u3', 5, 9000]]],
    ['c03', 11, [['p6', 'u2', 4, 15000]]],
    ['c03', 5, [['p1', 'u1', 40, 550], ['p9', 'u3', 1, 45000]]],
    ['c03', 1, [['p6', 'u2', 2, 15000]]],
    ['c04', 8, [['p5', 'u4', 15, 12500]]],
    ['c04', 4, [['p4', 'u3', 10, 9500], ['p6', 'u2', 1, 15500]]],
    ['c05', 12, [['p7', 'u5', 5, 18000]]],
    ['c05', 6, [['p8', 'u5', 2, 30000], ['p7', 'u5', 3, 18000]]],
    ['c05', 0, [['p7', 'u5', 1.5, 18000]]], // decimal quantity
    ['c06', 10, [['p3', 'u5', 3, 26000]]],
    ['c06', 2, [['p4', 'u3', 6, 9500]]],
    ['c07', 7, [['p2', 'u2', 20, 580]]],
    ['c07', 4, [['p2', 'u2', 15, 580]]],
    ['c07', 0, [['p2', 'u2', 10, 580], ['p8', 'u5', 0.5, 32000]]],
    ['c08', 9, [['p6', 'u2', 3, 15200]]],
    ['c08', 3, [['p9', 'u3', 2, 46000]]],
    ['c09', 5, [['p5', 'u4', 8, 13000]]],
    ['c10', 13, [['p1', 'u1', 200, 450], ['p2', 'u2', 100, 420]]],
    ['c10', 6, [['p3', 'u5', 10, 22000], ['p5', 'u4', 20, 10000]]],
    ['c10', 2, [['p4', 'u3', 24, 7000]]],
    ['c10', 0, [['p1', 'u1', 150, 450], ['p4', 'u3', 2, 7000, 'return']]], // return line on the same slip
    ['c11', 8, [['p6', 'u2', 2, 15000]]],
    ['c12', 4, [['p9', 'u3', 1, 47000], ['p4', 'u3', 2, 9800]]],
    ['c13', 6, [['p3', 'u5', 4, 25500]]],
    ['c14', 1, [['p7', 'u5', 2, 18500], ['p8', 'u5', 1, 31000]]],
    ['c15', 0, [['p5', 'u4', 5, 12800], ['p6', 'u2', 1, 15400]]],
  ]

  let seq = 0
  let orderNo = 0
  const orders: LedgerOrder[] = orderSpecs.map(([customerId, daysAgo, lines]) => {
    seq += 1
    orderNo += 1
    const orderLines = lines.map(([productId, unitId, qty, price, type], index) => ({
      id: `o${orderNo}l${index + 1}`,
      type: type === 'return' ? ('return' as const) : ('sell' as const),
      productId,
      unitId,
      qty,
      price,
      amount: Math.round(qty * price),
    }))
    return {
      id: `o${String(orderNo).padStart(3, '0')}`,
      code: `HĐ-${String(orderNo).padStart(4, '0')}`,
      customerId,
      date: d(daysAgo),
      seq,
      lines: orderLines,
      total: orderLines.reduce((sum, l) => sum + (l.type === 'return' ? -l.amount : l.amount), 0),
      editHistory: [],
      lastEditAt: null,
      deletedAt: null,
    }
  })

  // Two orders were edited after a statement export (the second one only for display).
  const order10 = orders.find((o) => o.code === 'HĐ-0010')
  if (order10) {
    order10.editHistory = [
      {
        editedAt: ts(1, 15, 20),
        changes: ['Dòng Bao kiếng / Cây: SL 30 → 40'],
        oldTotal: 61500,
        newTotal: 67000,
        diff: 5500,
      },
    ]
    order10.lastEditAt = ts(1, 15, 20)
    const firstLine = order10.lines[0]
    if (firstLine) {
      firstLine.qty = 40
      firstLine.amount = 40 * 550
    }
    order10.total = 67000
  }
  const order13 = orders.find((o) => o.code === 'HĐ-0013')
  if (order13) {
    order13.editHistory = [
      {
        editedAt: ts(2, 11, 5),
        changes: ['Dòng Băng keo trong / Cuộn: SL 8 → 10', 'Dòng Túi zip 15x22 / Tệp: SL 2 → 1'],
        oldTotal: 107000,
        newTotal: 110500,
        diff: 3500,
      },
    ]
    order13.lastEditAt = ts(2, 11, 5)
    order13.total = 110500
  }

  // VAT 8% invoice: the VAT amount is part of the debt.
  const order25 = orders.find((o) => o.code === 'HĐ-0025')
  if (order25) {
    order25.vat = { rate: 8, amount: 10560 }
    order25.total += 10560
  }

  // Order with an extra fee (delivery).
  const order33 = orders.find((o) => o.code === 'HĐ-0033')
  if (order33) {
    order33.fees = [{ id: 'f1', name: 'Tiền ship', amount: 25000 }]
    order33.total += 25000
  }

  const returns: LedgerReturn[] = [
    {
      id: 'r001',
      customerId: 'c02',
      date: d(2),
      seq: ++seq,
      lines: [{ productId: 'p1', unitId: 'u1', qty: 5, price: 600, amount: 3000 }],
      total: 3000,
      deletedAt: null,
    },
    {
      id: 'r002',
      customerId: 'c10',
      date: d(1),
      seq: ++seq,
      lines: [{ productId: 'p4', unitId: 'u3', qty: 2, price: 7000, amount: 14000 }],
      total: 14000,
      deletedAt: null,
    },
    {
      id: 'r003',
      customerId: 'c05',
      date: d(0),
      seq: ++seq,
      lines: [{ productId: 'p7', unitId: 'u5', qty: 0.5, price: 18000, amount: 9000 }],
      total: 9000,
      deletedAt: null,
    },
  ]

  const payment = (id: string, customerId: string, daysAgo: number, amount: number): LedgerPayment => ({
    id,
    customerId,
    date: d(daysAgo),
    seq: ++seq,
    amount,
    deletedAt: null,
  })
  const payments: LedgerPayment[] = [
    payment('tt001', 'c02', 8, 100000),
    payment('tt002', 'c10', 5, 500000),
    payment('tt003', 'c01', 4, 50000),
    payment('tt004', 'c05', 3, 200000),
    payment('tt005', 'c03', 2, 60000),
    payment('tt006', 'c02', 1, 50000),
    payment('tt007', 'c07', 0, 11600),
    payment('tt008', 'c06', 0, 80000),
  ]

  const adjustments: LedgerAdjustment[] = [
    { id: 'ps001', customerId: 'c02', date: d(5), seq: ++seq, amount: 30000, note: 'Tiền ship', deletedAt: null },
    {
      id: 'ps002',
      customerId: 'c03',
      date: d(2),
      seq: ++seq,
      amount: 120000,
      note: 'Tiền VAT hóa đơn số',
      deletedAt: null,
    },
    {
      id: 'ps003',
      customerId: 'c05',
      date: d(1),
      seq: ++seq,
      amount: -20000,
      note: 'Bớt nợ — khách quen',
      deletedAt: null,
    },
  ]

  const statementExports: SeedData['statementExports'] = [
    { id: 'se1', customerId: 'c03', from: d(14), to: d(3), exportedAt: ts(3, 18, 0) },
    { id: 'se2', customerId: 'c02', from: d(14), to: d(5), exportedAt: ts(5, 17, 30) },
  ]

  return {
    customers,
    products,
    units,
    priceBook,
    orders,
    returns,
    payments,
    statementExports,
    adjustments,
    counters: { orderNo, returnNo: 3, paymentNo: 8, adjustNo: 3, seq },
  }
}
