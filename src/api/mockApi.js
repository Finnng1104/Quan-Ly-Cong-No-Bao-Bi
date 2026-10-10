// ===== Lớp service giả lập API =====
// Mọi hàm nhận `state` hiện tại và trả về { data mới } — giai đoạn 2 thay bằng fetch() tới backend.
// Component KHÔNG thao tác dữ liệu trực tiếp, chỉ gọi qua store -> mockApi.

import { uid } from '../lib/format'
import { diffOrders } from '../lib/debt'

const nowISO = () => new Date().toISOString()

function nextSeq(state) {
  return { ...state.counters, seq: (state.counters.seq || 0) + 1 }
}

// ---------- Khách hàng ----------
export function createCustomer(state, payload) {
  return {
    customers: [
      ...state.customers,
      {
        id: uid('c'),
        name: payload.name,
        phone: payload.phone || '',
        address: payload.address || '',
        note: payload.note || '',
        openingDebt: {
          amount: Number(payload.openingDebt?.amount) || 0,
          date: payload.openingDebt?.date || new Date().toISOString().slice(0, 10),
        },
      },
    ],
  }
}

export function updateCustomer(state, id, payload) {
  return {
    customers: state.customers.map((c) =>
      c.id === id
        ? {
          ...c,
          name: payload.name ?? c.name,
          phone: payload.phone ?? c.phone,
          address: payload.address ?? c.address,
          note: payload.note ?? c.note,
          openingDebt: payload.openingDebt ?? c.openingDebt,
        }
        : c,
    ),
  }
}

// ---------- Sản phẩm & quy cách ----------
export function createProduct(state, name) {
  const p = { id: uid('p'), name }
  return { products: [...state.products, p], _created: p }
}
export function updateProduct(state, id, name) {
  return { products: state.products.map((p) => (p.id === id ? { ...p, name } : p)) }
}
export function deleteProduct(state, id) {
  return { products: state.products.filter((p) => p.id !== id) }
}
export function createUnit(state, name) {
  const u = { id: uid('u'), name }
  return { units: [...state.units, u], _created: u }
}
export function updateUnit(state, id, name) {
  return { units: state.units.map((u) => (u.id === id ? { ...u, name } : u)) }
}
export function deleteUnit(state, id) {
  return { units: state.units.filter((u) => u.id !== id) }
}

// ---------- Bảng giá ----------
export function setPrice(state, { customerId, productId, unitId, price }) {
  const found = state.priceBook.find(
    (x) => x.customerId === customerId && x.productId === productId && x.unitId === unitId,
  )
  if (found) {
    return {
      priceBook: state.priceBook.map((x) => (x.id === found.id ? { ...x, price: Number(price) } : x)),
    }
  }
  return {
    priceBook: [...state.priceBook, { id: uid('pb'), customerId, productId, unitId, price: Number(price) }],
  }
}

export function removePrice(state, priceId) {
  return { priceBook: state.priceBook.filter((x) => x.id !== priceId) }
}

export function copyPriceBook(state, fromCustomerId, toCustomerId) {
  const kept = state.priceBook.filter((x) => x.customerId !== toCustomerId)
  const copied = state.priceBook
    .filter((x) => x.customerId === fromCustomerId)
    .map((x) => ({ ...x, id: uid('pb'), customerId: toCustomerId }))
  return { priceBook: [...kept, ...copied] }
}

export function getPrice(state, customerId, productId, unitId) {
  const found = state.priceBook.find(
    (x) => x.customerId === customerId && x.productId === productId && x.unitId === unitId,
  )
  return found ? found.price : null
}

// ---------- Đơn hàng ----------
// dòng "sell" cộng nợ, dòng "return" trừ nợ (hàng trả gộp chung phiếu)
const signed = (l) => (l.type === 'return' ? -l.amount : l.amount)

function makeLines(lines) {
  return lines.map((l) => ({
    id: l.id || uid('l'),
    type: l.type === 'return' ? 'return' : 'sell',
    productId: l.productId,
    unitId: l.unitId,
    qty: Number(l.qty) || 0,
    price: Number(l.price) || 0,
    amount: Math.round((Number(l.qty) || 0) * (Number(l.price) || 0)),
  }))
}

const lineTotal = (lines) => lines.reduce((s, l) => s + signed(l), 0)
const sellTotal = (lines) =>
  lines.reduce((s, l) => s + (l.type === 'return' ? 0 : l.amount), 0)

// Tiền VAT hóa đơn cộng vào công nợ khách (thu trên tổng hàng bán, không tính hàng trả)
function makeVat(lines, vat, vatRate = 8) {
  if (!vat) return null
  return { rate: vatRate, amount: Math.round(sellTotal(lines) * (vatRate / 100)) }
}

export function createOrder(state, { customerId, date, lines, vat, vatRate }) {
  const ls = makeLines(lines)
  const orderNo = state.counters.orderNo + 1
  const vatObj = makeVat(ls, vat, vatRate)
  const order = {
    id: uid('o'),
    code: `HĐ-${String(orderNo).padStart(4, '0')}`,
    customerId,
    date,
    seq: nextSeq(state).seq,
    createdAt: nowISO(),
    lines: ls,
    vat: vatObj,
    total: lineTotal(ls) + (vatObj?.amount || 0),
    editHistory: [],
    lastEditAt: null,
    deletedAt: null,
  }
  return {
    orders: [...state.orders, order],
    counters: { ...nextSeq(state), orderNo },
    _created: order,
  }
}

export function updateOrder(state, orderId, { customerId, date, lines, vat, vatRate }, lookups) {
  const orders = state.orders.map((o) => {
    if (o.id !== orderId) return o
    const ls = makeLines(lines)
    const vatObj = makeVat(ls, vat, vatRate)
    const next = {
      ...o,
      customerId,
      date,
      lines: ls,
      vat: vatObj,
      total: lineTotal(ls) + (vatObj?.amount || 0),
    }
    const diff = diffOrders(o, next, lookups)
    const entry = { editedAt: nowISO(), ...diff }
    return {
      ...next,
      editHistory: [...(o.editHistory || []), entry],
      lastEditAt: nowISO(),
    }
  })
  return { orders }
}

export function deleteOrder(state, orderId) {
  return {
    orders: state.orders.map((o) => (o.id === orderId ? { ...o, deletedAt: nowISO() } : o)),
  }
}

export function restoreOrder(state, orderId) {
  return {
    orders: state.orders.map((o) => (o.id === orderId ? { ...o, deletedAt: null } : o)),
  }
}

// ---------- Hàng trả ----------
export function createReturn(state, { customerId, date, lines, reason }) {
  const ls = makeLines(lines)
  const no = state.counters.returnNo + 1
  const rec = {
    id: uid('r'),
    code: `TH-${String(no).padStart(4, '0')}`,
    customerId,
    date,
    seq: nextSeq(state).seq,
    createdAt: nowISO(),
    lines: ls,
    total: ls.reduce((s, l) => s + l.amount, 0),
    reason: reason || '',
    deletedAt: null,
  }
  return {
    returns: [...state.returns, rec],
    counters: { ...nextSeq(state), returnNo: no },
    _created: rec,
  }
}

export function deleteReturn(state, id) {
  return { returns: state.returns.map((r) => (r.id === id ? { ...r, deletedAt: nowISO() } : r)) }
}

// ---------- Thanh toán ----------
export function createPayment(state, { customerId, date, amount, note }) {
  const no = state.counters.paymentNo + 1
  const rec = {
    id: uid('tt'),
    code: `TT-${String(no).padStart(4, '0')}`,
    customerId,
    date,
    seq: nextSeq(state).seq,
    createdAt: nowISO(),
    amount: Number(amount) || 0,
    note: note || '',
    deletedAt: null,
  }
  return {
    payments: [...state.payments, rec],
    counters: { ...nextSeq(state), paymentNo: no },
    _created: rec,
  }
}

export function deletePayment(state, id) {
  return { payments: state.payments.map((p) => (p.id === id ? { ...p, deletedAt: nowISO() } : p)) }
}

// ---------- Sao kê ----------
export function recordStatementExport(state, { customerId, from, to }) {
  const rec = { id: uid('se'), customerId, from, to, exportedAt: nowISO() }
  return { statementExports: [...state.statementExports, rec], _created: rec }
}

export function lastExportOf(state, customerId) {
  const list = state.statementExports
    .filter((x) => x.customerId === customerId)
    .sort((a, b) => (a.exportedAt < b.exportedAt ? -1 : 1))
  return list[list.length - 1] || null
}

/** Đơn của khách bị sửa sau `timestamp` (ISO) -> đánh dấu "Đã điều chỉnh" ở sao kê. */
export function ordersEditedAfter(state, customerId, timestamp) {
  if (!timestamp) return []
  return state.orders.filter(
    (o) => o.customerId === customerId && !o.deletedAt && o.lastEditAt && o.lastEditAt > timestamp,
  )
}
