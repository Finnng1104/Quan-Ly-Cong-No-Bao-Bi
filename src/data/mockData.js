// ===== Dữ liệu mẫu nạp sẵn — tạo ngày tương đối theo hôm nay để mọi màn hình có số liệu =====
import { todayISO, addDaysISO } from '../lib/format'

// d(n) = ngày cách đây n ngày (d(0) = hôm nay)
const d = (n) => addDaysISO(todayISO(), -n)
// ts(n, h, m) = timestamp ISO cách đây n ngày
const ts = (n, h = 10, m = 0) => `${d(n)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`

export function buildSeed() {
  const customers = [
    { id: 'c01', name: 'Thanh Nhi', phone: '0901234001', address: '12 Lê Lợi, Q.1', note: 'Khách quen, lấy bao kiếng', openingDebt: { amount: 59356, date: d(30) } },
    { id: 'c02', name: 'Ông A (Nguyễn Văn An)', phone: '0901234002', address: '45 Trần Hưng Đạo', note: '', openingDebt: { amount: 120000, date: d(30) } },
    { id: 'c03', name: 'Chị Hoa', phone: '0901234003', address: '8 Nguyễn Trãi', note: 'Giao hàng buổi sáng', openingDebt: { amount: 45000, date: d(30) } },
    { id: 'c04', name: 'Anh Tuấn', phone: '0901234004', address: '100 Võ Văn Tần', note: '', openingDebt: { amount: 0, date: d(30) } },
    { id: 'c05', name: 'Cô Lan', phone: '0901234005', address: '23 Hai Bà Trưng', note: '', openingDebt: { amount: 210500, date: d(30) } },
    { id: 'c06', name: 'Bác Sáu', phone: '0901234006', address: '77 Điện Biên Phủ', note: '', openingDebt: { amount: 88000, date: d(30) } },
    { id: 'c07', name: 'Quán Cơm Bình Dân', phone: '0901234007', address: '5 Cách Mạng Tháng 8', note: 'Lấy giấy A6 hàng tuần', openingDebt: { amount: 0, date: d(30) } },
    { id: 'c08', name: 'Chị Phượng', phone: '0901234008', address: '31 Pasteur', note: '', openingDebt: { amount: 34000, date: d(30) } },
    { id: 'c09', name: 'Anh Khoa', phone: '0901234009', address: '19 Lý Tự Trọng', note: '', openingDebt: { amount: 0, date: d(30) } },
    { id: 'c10', name: 'Cửa hàng Minh Phát', phone: '0901234010', address: '210 Hoàng Văn Thụ', note: 'Đại lý lớn', openingDebt: { amount: 500000, date: d(30) } },
    { id: 'c11', name: 'Chị Nga', phone: '0901234011', address: '66 Ngô Gia Tự', note: '', openingDebt: { amount: 15000, date: d(30) } },
    { id: 'c12', name: 'Anh Dũng', phone: '0901234012', address: '3 Bạch Đằng', note: '', openingDebt: { amount: 0, date: d(30) } },
    { id: 'c13', name: 'Cô Tư', phone: '0901234013', address: '152 Phan Đăng Lưu', note: '', openingDebt: { amount: 76000, date: d(30) } },
    { id: 'c14', name: 'Chị Yến', phone: '0901234014', address: '9 Nam Kỳ Khởi Nghĩa', note: '', openingDebt: { amount: 0, date: d(30) } },
    { id: 'c15', name: 'Anh Phúc', phone: '0901234015', address: '88 Xô Viết Nghệ Tĩnh', note: '', openingDebt: { amount: 0, date: d(30) } },
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

  // Bảng giá riêng: {customerId, productId, unitId, price}
  const priceBook = [
    // Thanh Nhi — giá sỉ đặc biệt
    { id: 'pb1', customerId: 'c01', productId: 'p1', unitId: 'u1', price: 500 },
    { id: 'pb2', customerId: 'c01', productId: 'p2', unitId: 'u2', price: 500 },
    { id: 'pb3', customerId: 'c01', productId: 'p3', unitId: 'u5', price: 25000 },
    { id: 'pb4', customerId: 'c01', productId: 'p4', unitId: 'u3', price: 8000 },
    // Ông A
    { id: 'pb5', customerId: 'c02', productId: 'p1', unitId: 'u1', price: 600 },
    { id: 'pb6', customerId: 'c02', productId: 'p2', unitId: 'u2', price: 550 },
    { id: 'pb7', customerId: 'c02', productId: 'p5', unitId: 'u4', price: 12000 },
    // Chị Hoa
    { id: 'pb8', customerId: 'c03', productId: 'p1', unitId: 'u1', price: 550 },
    { id: 'pb9', customerId: 'c03', productId: 'p6', unitId: 'u2', price: 15000 },
    { id: 'pb10', customerId: 'c03', productId: 'p9', unitId: 'u3', price: 45000 },
    // Minh Phát — đại lý
    { id: 'pb11', customerId: 'c10', productId: 'p1', unitId: 'u1', price: 450 },
    { id: 'pb12', customerId: 'c10', productId: 'p2', unitId: 'u2', price: 420 },
    { id: 'pb13', customerId: 'c10', productId: 'p3', unitId: 'u5', price: 22000 },
    { id: 'pb14', customerId: 'c10', productId: 'p4', unitId: 'u3', price: 7000 },
    { id: 'pb15', customerId: 'c10', productId: 'p5', unitId: 'u4', price: 10000 },
    // Cô Lan
    { id: 'pb16', customerId: 'c05', productId: 'p7', unitId: 'u5', price: 18000 },
    { id: 'pb17', customerId: 'c05', productId: 'p8', unitId: 'u5', price: 30000 },
  ]

  // ===== Đơn hàng: [khách, cách đây n ngày, [[productId, unitId, qty, price], ...]] =====
  const orderSpecs = [
    ['c01', 2, [['p1', 'u1', 20, 500], ['p2', 'u2', 5, 500]]], // đơn nghiệm thu: 12.500
    ['c01', 6, [['p3', 'u5', 2, 25000]]],
    ['c01', 0, [['p4', 'u3', 3, 8000], ['p1', 'u1', 10, 500]]],
    ['c02', 9, [['p1', 'u1', 50, 600]]],
    ['c02', 7, [['p5', 'u4', 10, 12000], ['p2', 'u2', 8, 550]]],
    ['c02', 3, [['p1', 'u1', 30, 600]]],
    ['c02', 3, [['p2', 'u2', 12, 550]]], // cùng ngày, đơn sau
    ['c02', 1, [['p4', 'u3', 5, 9000]]],
    ['c03', 11, [['p6', 'u2', 4, 15000]]],
    ['c03', 5, [['p1', 'u1', 40, 550], ['p9', 'u3', 1, 45000]]],
    ['c03', 1, [['p6', 'u2', 2, 15000]]],
    ['c04', 8, [['p5', 'u4', 15, 12500]]],
    ['c04', 4, [['p4', 'u3', 10, 9500], ['p6', 'u2', 1, 15500]]],
    ['c05', 12, [['p7', 'u5', 5, 18000]]],
    ['c05', 6, [['p8', 'u5', 2, 30000], ['p7', 'u5', 3, 18000]]],
    ['c05', 0, [['p7', 'u5', 1.5, 18000]]], // số lượng thập phân
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
    ['c10', 0, [['p1', 'u1', 150, 450], ['p4', 'u3', 2, 7000, 'return']]], // phiếu có hàng trả gộp chung
    ['c11', 8, [['p6', 'u2', 2, 15000]]],
    ['c12', 4, [['p9', 'u3', 1, 47000], ['p4', 'u3', 2, 9800]]],
    ['c13', 6, [['p3', 'u5', 4, 25500]]],
    ['c14', 1, [['p7', 'u5', 2, 18500], ['p8', 'u5', 1, 31000]]],
    ['c15', 0, [['p5', 'u4', 5, 12800], ['p6', 'u2', 1, 15400]]],
  ]

  let seq = 0
  let orderNo = 0
  const orders = orderSpecs.map(([custId, ago, lines]) => {
    seq += 1
    orderNo += 1
    const lineObjs = lines.map(([productId, unitId, qty, price, type], i) => ({
      id: `o${orderNo}l${i + 1}`,
      type: type === 'return' ? 'return' : 'sell',
      productId,
      unitId,
      qty,
      price,
      amount: Math.round(qty * price),
    }))
    return {
      id: `o${String(orderNo).padStart(3, '0')}`,
      code: `HĐ-${String(orderNo).padStart(4, '0')}`,
      customerId: custId,
      date: d(ago),
      seq,
      createdAt: ts(ago, 9 + (orderNo % 8)),
      lines: lineObjs,
      total: lineObjs.reduce((s, l) => s + (l.type === 'return' ? -l.amount : l.amount), 0),
      editHistory: [],
      lastEditAt: null,
      deletedAt: null,
    }
  })

  // Đánh dấu 2 đơn đã điều chỉnh (đơn của Chị Hoa sửa SAU lần xuất sao kê gần nhất)
  const o10 = orders.find((o) => o.code === 'HĐ-0010') // Chị Hoa, c03, ngày -5
  if (o10) {
    o10.editHistory = [
      {
        editedAt: ts(1, 15, 20),
        changes: ['Dòng Bao kiếng / Cây: SL 30 → 40'],
        oldTotal: 61500,
        newTotal: 67000,
        diff: 5500,
      },
    ]
    o10.lastEditAt = ts(1, 15, 20)
    // điều chỉnh lại số lượng/tổng cho khớp lịch sử
    o10.lines[0].qty = 40
    o10.lines[0].amount = 40 * 550
    o10.total = 67000
  }
  const o13 = orders.find((o) => o.code === 'HĐ-0013') // Anh Tuấn c04 ngày -4
  if (o13) {
    o13.editHistory = [
      {
        editedAt: ts(2, 11, 5),
        changes: ['Dòng Băng keo trong / Cuộn: SL 8 → 10', 'Dòng Túi zip 15x22 / Tệp: SL 2 → 1'],
        oldTotal: 107000,
        newTotal: 110500,
        diff: 3500,
      },
    ]
    o13.lastEditAt = ts(2, 11, 5)
    o13.total = 110500
  }

  // Đơn xuất hóa đơn VAT 8% — tiền VAT cộng vào công nợ
  const o25 = orders.find((o) => o.code === 'HĐ-0025') // Minh Phát c10
  if (o25) {
    o25.vat = { rate: 8, amount: 10560 }
    o25.total += 10560
  }

  // ===== Hàng trả =====
  const returns = [
    {
      id: 'r001',
      code: 'TH-0001',
      customerId: 'c02',
      date: d(2),
      seq: ++seq,
      createdAt: ts(2, 14),
      reason: 'Trả bao kiếng bị rách',
      lines: [{ id: 'r1l1', productId: 'p1', unitId: 'u1', qty: 5, price: 600, amount: 3000 }],
      total: 3000,
      deletedAt: null,
    },
    {
      id: 'r002',
      code: 'TH-0002',
      customerId: 'c10',
      date: d(1),
      seq: ++seq,
      createdAt: ts(1, 16, 30),
      reason: '',
      lines: [{ id: 'r2l1', productId: 'p4', unitId: 'u3', qty: 2, price: 7000, amount: 14000 }],
      total: 14000,
      deletedAt: null,
    },
    {
      id: 'r003',
      code: 'TH-0003',
      customerId: 'c05',
      date: d(0),
      seq: ++seq,
      createdAt: ts(0, 9),
      reason: 'Khách đổi ý',
      lines: [{ id: 'r3l1', productId: 'p7', unitId: 'u5', qty: 0.5, price: 18000, amount: 9000 }],
      total: 9000,
      deletedAt: null,
    },
  ]

  // ===== Thanh toán =====
  const payments = [
    { id: 'tt001', code: 'TT-0001', customerId: 'c02', date: d(8), seq: ++seq, createdAt: ts(8, 10), amount: 100000, note: 'Trả bớt nợ cũ', deletedAt: null },
    { id: 'tt002', code: 'TT-0002', customerId: 'c10', date: d(5), seq: ++seq, createdAt: ts(5, 15), amount: 500000, note: '', deletedAt: null },
    { id: 'tt003', code: 'TT-0003', customerId: 'c01', date: d(4), seq: ++seq, createdAt: ts(4, 11), amount: 50000, note: 'Thanh Nhi trả', deletedAt: null },
    { id: 'tt004', code: 'TT-0004', customerId: 'c05', date: d(3), seq: ++seq, createdAt: ts(3, 9, 30), amount: 200000, note: '', deletedAt: null },
    { id: 'tt005', code: 'TT-0005', customerId: 'c03', date: d(2), seq: ++seq, createdAt: ts(2, 17), amount: 60000, note: '', deletedAt: null },
    { id: 'tt006', code: 'TT-0006', customerId: 'c02', date: d(1), seq: ++seq, createdAt: ts(1, 8), amount: 50000, note: '', deletedAt: null },
    { id: 'tt007', code: 'TT-0007', customerId: 'c07', date: d(0), seq: ++seq, createdAt: ts(0, 8, 45), amount: 11600, note: 'Trả đơn sáng nay', deletedAt: null },
    { id: 'tt008', code: 'TT-0008', customerId: 'c06', date: d(0), seq: ++seq, createdAt: ts(0, 10, 15), amount: 80000, note: '', deletedAt: null },
  ]

  // ===== Lần xuất sao kê gần nhất của Chị Hoa (đơn HĐ-0010 sửa sau đó) =====
  const statementExports = [
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
    counters: { orderNo, returnNo: 3, paymentNo: 8, seq },
  }
}
