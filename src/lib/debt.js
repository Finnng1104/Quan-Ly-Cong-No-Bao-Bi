// ===== Hàm thuần tính công nợ — tái sử dụng được cho backend =====
// Quy ước:
//  - Dư nợ khách tại ngày X = Nợ đầu kỳ + Tổng đơn - Tổng hàng trả - Tổng thanh toán
//    (chỉ tính các phát sinh có ngày <= X)
//  - Công nợ GỘP THEO KHÁCH, thanh toán trừ thẳng vào nợ chung, không phân bổ theo đơn.
//  - Dư nợ luôn TÍNH từ phát sinh mới nhất (đơn sửa ngày cũ vẫn tính theo giá trị mới).
//  - Ngày là chuỗi 'YYYY-MM-DD', so sánh trực tiếp.
//  - `seq` là thứ tự phát sinh trong ngày (đơn sau đứng sau đơn trước).

import { dayBeforeISO } from './format'

export const KIND = {
  OPENING: 'opening',
  ORDER: 'order',
  RETURN: 'return',
  PAYMENT: 'payment',
  ADJUST: 'adjust',
}

const KIND_RANK = { opening: 0, order: 1, adjust: 2, return: 3, payment: 4 }

function cmpEvent(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.seq !== b.seq) return a.seq - b.seq
  return (KIND_RANK[a.kind] || 9) - (KIND_RANK[b.kind] || 9)
}

/** Tất cả phát sinh của 1 khách, sắp theo (ngày, seq). Gồm cả sự kiện nợ đầu kỳ. */
export function eventsFor(customerId, data) {
  const evs = []
  const c = data.customers.find((x) => x.id === customerId)
  if (c && c.openingDebt && Number(c.openingDebt.amount)) {
    evs.push({
      kind: KIND.OPENING,
      date: c.openingDebt.date,
      seq: -1,
      delta: Number(c.openingDebt.amount),
      refId: null,
      desc: 'Nợ đầu kỳ',
    })
  }
  for (const o of data.orders) {
    if (o.customerId !== customerId || o.deletedAt) continue
    evs.push({
      kind: KIND.ORDER,
      date: o.date,
      seq: o.seq ?? 0,
      delta: Number(o.total),
      refId: o.id,
      code: o.code,
      desc: `Đơn hàng ${o.code}`,
    })
  }
  for (const r of data.returns) {
    if (r.customerId !== customerId || r.deletedAt) continue
    evs.push({
      kind: KIND.RETURN,
      date: r.date,
      seq: r.seq ?? 0,
      delta: -Number(r.total),
      refId: r.id,
      desc: 'Trả hàng',
    })
  }
  for (const p of data.payments) {
    if (p.customerId !== customerId || p.deletedAt) continue
    evs.push({
      kind: KIND.PAYMENT,
      date: p.date,
      seq: p.seq ?? 0,
      delta: -Number(p.amount),
      refId: p.id,
      desc: 'Thanh toán',
    })
  }
  for (const a of data.adjustments || []) {
    if (a.customerId !== customerId || a.deletedAt) continue
    const amt = Number(a.amount)
    evs.push({
      kind: KIND.ADJUST,
      date: a.date,
      seq: a.seq ?? 0,
      delta: amt,
      refId: a.id,
      desc: a.note || (amt >= 0 ? 'Phát sinh cộng nợ' : 'Phát sinh trừ nợ'),
    })
  }
  return evs.sort(cmpEvent)
}

/** Dư nợ của 1 khách tại ngày `date` (gồm các phát sinh ngày <= date). */
export function balanceAt(customerId, data, date) {
  let sum = 0
  for (const e of eventsFor(customerId, data)) {
    if (e.date <= date) sum += e.delta
  }
  return sum
}

/**
 * Dư nợ của khách NGAY TRƯỚC một đơn cụ thể (= "Công nợ cũ" trên phiếu).
 * Nhiều đơn cùng ngày: nợ cũ của đơn sau = nợ mới của đơn trước.
 */
export function balanceBeforeOrder(customerId, data, order) {
  const evs = eventsFor(customerId, data)
  const target = {
    kind: KIND.ORDER,
    date: order.date,
    seq: order.seq ?? 0,
  }
  let sum = 0
  for (const e of evs) {
    if (e.refId === order.id) break
    if (cmpEvent(e, target) < 0) sum += e.delta
  }
  return sum
}

/** Map customerId -> dư nợ tại ngày `date`. */
export function debtsByCustomer(data, date) {
  const map = {}
  for (const c of data.customers) map[c.id] = 0
  // gộp event của tất cả khách một lần cho nhanh
  for (const c of data.customers) {
    map[c.id] = balanceAt(c.id, data, date)
  }
  return map
}

/** Tổng công nợ toàn bộ khách tại ngày `date`. */
export function totalDebtAt(data, date) {
  let sum = 0
  for (const c of data.customers) sum += balanceAt(c.id, data, date)
  return sum
}

/**
 * Công nợ PHÁT SINH của từng khách trong đúng ngày `date`:
 * map customerId -> {up, down} (up = tổng đơn, down = tổng thu + hàng trả)
 */
export function dayActivitiesByCustomer(data, date) {
  const map = {}
  const acc = (id) => (map[id] ||= { up: 0, down: 0 })
  for (const o of data.orders) {
    if (!o.deletedAt && o.date === date) acc(o.customerId).up += Number(o.total)
  }
  for (const r of data.returns) {
    if (!r.deletedAt && r.date === date) acc(r.customerId).down += Number(r.total)
  }
  for (const p of data.payments) {
    if (!p.deletedAt && p.date === date) acc(p.customerId).down += Number(p.amount)
  }
  return map
}

/** Tổng đơn / thu / trả của đúng 1 ngày. */
export function dailyTotals(data, date) {
  let orders = 0
  let orderCount = 0
  let payments = 0
  let paymentCount = 0
  let returns = 0
  for (const o of data.orders) {
    if (!o.deletedAt && o.date === date) {
      orders += Number(o.total)
      orderCount += 1
    }
  }
  for (const p of data.payments) {
    if (!p.deletedAt && p.date === date) {
      payments += Number(p.amount)
      paymentCount += 1
    }
  }
  for (const r of data.returns) {
    if (!r.deletedAt && r.date === date) returns += Number(r.total)
  }
  return { orders, orderCount, payments, paymentCount, returns }
}

/** Tổng đơn / thu / trả trong khoảng [from, to] (inclusive). */
export function rangeTotals(data, from, to) {
  let orders = 0
  let payments = 0
  let returns = 0
  let orderCount = 0
  for (const o of data.orders) {
    if (!o.deletedAt && o.date >= from && o.date <= to) {
      orders += Number(o.total)
      orderCount += 1
    }
  }
  for (const p of data.payments) {
    if (!p.deletedAt && p.date >= from && p.date <= to) payments += Number(p.amount)
  }
  for (const r of data.returns) {
    if (!r.deletedAt && r.date >= from && r.date <= to) returns += Number(r.total)
  }
  return { orders, payments, returns, orderCount }
}

/**
 * Sổ công nợ / sao kê của 1 khách trong khoảng [from, to].
 * Trả về { opening, rows, closing } — mỗi row: {date, seq, kind, desc, refId, code, up, down, balance}
 * `opening` = dư nợ tính đến ngày trước `from` (dư đầu khoảng).
 */
export function ledgerRows(customerId, data, from, to) {
  const opening = balanceAt(customerId, data, dayBeforeISO(from))
  let balance = opening
  const rows = []
  for (const e of eventsFor(customerId, data)) {
    if (e.date < from || e.date > to) continue
    balance += e.delta
    rows.push({
      date: e.date,
      seq: e.seq,
      kind: e.kind,
      desc: e.desc,
      refId: e.refId,
      code: e.code,
      up: e.delta > 0 ? e.delta : 0,
      down: e.delta < 0 ? -e.delta : 0,
      balance,
    })
  }
  return { opening, rows, closing: balance }
}

/** Toàn bộ phát sinh của khách (không lọc ngày) kèm dư nợ lũy kế — dùng cho tab Sổ công nợ. */
export function fullLedger(customerId, data, until) {
  let balance = 0
  const rows = []
  for (const e of eventsFor(customerId, data)) {
    if (until && e.date > until) break
    balance += e.delta
    rows.push({ ...e, up: e.delta > 0 ? e.delta : 0, down: e.delta < 0 ? -e.delta : 0, balance })
  }
  return rows
}

/** Số lượng đã mua / đã trả theo (sản phẩm + quy cách) của 1 khách — kiểm tra trả vượt. */
export function purchasedReturned(customerId, data) {
  const map = new Map()
  const key = (l) => `${l.productId}|${l.unitId}`
  for (const o of data.orders) {
    if (o.customerId !== customerId || o.deletedAt) continue
    for (const l of o.lines) {
      const k = key(l)
      const cur = map.get(k) || { bought: 0, returned: 0 }
      if (l.type === 'return') cur.returned += Number(l.qty)
      else cur.bought += Number(l.qty)
      map.set(k, cur)
    }
  }
  for (const r of data.returns) {
    if (r.customerId !== customerId || r.deletedAt) continue
    for (const l of r.lines) {
      const k = key(l)
      const cur = map.get(k) || { bought: 0, returned: 0 }
      cur.returned += Number(l.qty)
      map.set(k, cur)
    }
  }
  return map
}

/** Tổng tiền hàng khách đã lấy trong khoảng [from, to] (tổng giá trị các đơn, có đếm đơn). */
export function purchaseTotal(customerId, data, from, to) {
  let total = 0
  let count = 0
  for (const o of data.orders) {
    if (o.customerId !== customerId || o.deletedAt) continue
    if (o.date < from || o.date > to) continue
    total += Number(o.total)
    count += 1
  }
  return { total, count }
}

/** Chuỗi ngày phục vụ biểu đồ: tổng nợ, doanh số, tiền thu của `n` ngày kết thúc tại `endDate`. */
export function debtSeries(data, endDate, n, addDaysISO) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = addDaysISO(endDate, -i)
    const t = dailyTotals(data, d)
    out.push({ date: d, debt: totalDebtAt(data, d), sales: t.orders, collected: t.payments })
  }
  return out
}

/**
 * So sánh đơn cũ/mới khi sửa đơn -> bản ghi lịch sử điều chỉnh.
 * Trả về { oldTotal, newTotal, diff, changes: [text] }
 */
export function diffOrders(oldOrder, next, lookups) {
  const { productName, unitName, customerName, fmtMoney, fmtQty, fmtDate } = lookups
  const changes = []
  if (oldOrder.customerId !== next.customerId) {
    changes.push(`Đổi khách: ${customerName(oldOrder.customerId)} → ${customerName(next.customerId)}`)
  }
  if (oldOrder.date !== next.date) {
    changes.push(`Đổi ngày: ${fmtDate(oldOrder.date)} → ${fmtDate(next.date)}`)
  }
  const oldVat = oldOrder.vat?.amount || 0
  const newVat = next.vat?.amount || 0
  if (oldVat !== newVat) {
    changes.push(
      newVat === 0
        ? `Bỏ tiền VAT (−${fmtMoney(oldVat)})`
        : oldVat === 0
          ? `Thêm tiền VAT${next.vat.manual ? ' (nhập tay)' : ` ${next.vat.rate}%`}: +${fmtMoney(newVat)}`
          : `Tiền VAT: ${fmtMoney(oldVat)} → ${fmtMoney(newVat)}`,
    )
  }
  if ((oldOrder.note || '') !== (next.note || '')) {
    changes.push('Đổi ghi chú đơn')
  }
  const oldFees = new Map((oldOrder.fees || []).map((f) => [f.id, f]))
  const newFees = new Map((next.fees || []).map((f) => [f.id, f]))
  for (const f of next.fees || []) {
    const prev = oldFees.get(f.id)
    if (!prev) changes.push(`Thêm phí "${f.name}": +${fmtMoney(f.amount)}`)
    else if (prev.amount !== f.amount || prev.name !== f.name)
      changes.push(`Phí "${f.name}": ${fmtMoney(prev.amount)} → ${fmtMoney(f.amount)}`)
  }
  for (const f of oldOrder.fees || []) {
    if (!newFees.has(f.id)) changes.push(`Xóa phí "${f.name}": −${fmtMoney(f.amount)}`)
  }
  const oldById = new Map(oldOrder.lines.map((l) => [l.id, l]))
  const newById = new Map(next.lines.map((l) => [l.id, l]))
  for (const l of next.lines) {
    const name = `${productName(l.productId)} / ${unitName(l.unitId)}`
    const prev = oldById.get(l.id)
    if (!prev) {
      changes.push(
        `${l.type === 'return' ? 'Thêm dòng trả' : 'Thêm dòng'} ${name}: ${fmtQty(l.qty)} x ${fmtMoney(l.price)}`,
      )
      continue
    }
    const parts = []
    if ((prev.type || 'sell') !== (l.type || 'sell')) {
      parts.push(l.type === 'return' ? 'đổi thành dòng trả' : 'đổi thành dòng bán')
    }
    if (prev.productId !== l.productId || prev.unitId !== l.unitId) {
      parts.push(`hàng ${productName(prev.productId)}/${unitName(prev.unitId)} → ${name}`)
    }
    if (Number(prev.qty) !== Number(l.qty)) parts.push(`SL ${fmtQty(prev.qty)} → ${fmtQty(l.qty)}`)
    if (Number(prev.price) !== Number(l.price)) parts.push(`giá ${fmtMoney(prev.price)} → ${fmtMoney(l.price)}`)
    if (parts.length) changes.push(`Dòng ${name}: ${parts.join(', ')}`)
  }
  for (const l of oldOrder.lines) {
    if (!newById.has(l.id)) {
      changes.push(
        `${l.type === 'return' ? 'Xóa dòng trả' : 'Xóa dòng'} ${productName(l.productId)}/${unitName(l.unitId)}: ${fmtQty(l.qty)} x ${fmtMoney(l.price)}`,
      )
    }
  }
  return { oldTotal: oldOrder.total, newTotal: next.total, diff: next.total - oldOrder.total, changes }
}
