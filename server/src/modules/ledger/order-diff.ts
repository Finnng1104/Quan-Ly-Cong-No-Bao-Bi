// Builds the human-readable edit history of an order (D-26): the server stores plain Vietnamese
// sentences, exactly like the web app's `diffOrders`, so the history screen needs no changes.

import { formatDate, formatMoney, formatQty } from '../../shared/format.js'
import type { LedgerOrderFee, LedgerOrderLine } from './types.js'

/** The parts of an order that an edit can change. */
export interface DiffableOrder {
  customerId: string
  date: string
  total: number
  note?: string | undefined
  vat?: { rate?: number | undefined; amount: number; manual?: boolean | undefined } | null | undefined
  fees?: LedgerOrderFee[] | undefined
  lines: LedgerOrderLine[]
}

/** Resolves ids to the names shown in the text, as they are at the moment of the edit. */
export interface DiffLookups {
  productName(id: string): string
  unitName(id: string): string
  customerName(id: string): string
  fmtMoney?(value: number): string
  fmtQty?(value: number): string
  fmtDate?(iso: string): string
}

export interface OrderDiff {
  oldTotal: number
  newTotal: number
  diff: number
  changes: string[]
}

export function diffOrders(
  oldOrder: DiffableOrder,
  next: DiffableOrder,
  lookups: DiffLookups,
): OrderDiff {
  const { productName, unitName, customerName } = lookups
  const money = lookups.fmtMoney ?? formatMoney
  const qty = lookups.fmtQty ?? formatQty
  const date = lookups.fmtDate ?? formatDate
  const changes: string[] = []

  if (oldOrder.customerId !== next.customerId) {
    changes.push(`Đổi khách: ${customerName(oldOrder.customerId)} → ${customerName(next.customerId)}`)
  }
  if (oldOrder.date !== next.date) {
    changes.push(`Đổi ngày: ${date(oldOrder.date)} → ${date(next.date)}`)
  }

  const oldVat = oldOrder.vat?.amount || 0
  const newVat = next.vat?.amount || 0
  if (oldVat !== newVat) {
    if (newVat === 0) {
      changes.push(`Bỏ tiền VAT (−${money(oldVat)})`)
    } else if (oldVat === 0) {
      const label = next.vat?.manual ? ' (nhập tay)' : ` ${String(next.vat?.rate)}%`
      changes.push(`Thêm tiền VAT${label}: +${money(newVat)}`)
    } else {
      changes.push(`Tiền VAT: ${money(oldVat)} → ${money(newVat)}`)
    }
  }

  if ((oldOrder.note || '') !== (next.note || '')) {
    changes.push('Đổi ghi chú đơn')
  }

  const oldFees = new Map((oldOrder.fees ?? []).map((fee) => [fee.id, fee]))
  const newFees = new Map((next.fees ?? []).map((fee) => [fee.id, fee]))
  for (const fee of next.fees ?? []) {
    const previous = oldFees.get(fee.id)
    if (!previous) {
      changes.push(`Thêm phí "${fee.name}": +${money(fee.amount)}`)
    } else if (previous.amount !== fee.amount || previous.name !== fee.name) {
      changes.push(`Phí "${fee.name}": ${money(previous.amount)} → ${money(fee.amount)}`)
    }
  }
  for (const fee of oldOrder.fees ?? []) {
    if (!newFees.has(fee.id)) changes.push(`Xóa phí "${fee.name}": −${money(fee.amount)}`)
  }

  const oldLines = new Map(oldOrder.lines.map((line) => [line.id, line]))
  const newLines = new Map(next.lines.map((line) => [line.id, line]))
  for (const line of next.lines) {
    const label = `${productName(line.productId)} / ${unitName(line.unitId)}`
    const previous = oldLines.get(line.id)

    if (!previous) {
      const prefix = line.type === 'return' ? 'Thêm dòng trả' : 'Thêm dòng'
      changes.push(`${prefix} ${label}: ${qty(line.qty)} x ${money(line.price)}`)
      continue
    }

    const parts: string[] = []
    if ((previous.type || 'sell') !== (line.type || 'sell')) {
      parts.push(line.type === 'return' ? 'đổi thành dòng trả' : 'đổi thành dòng bán')
    }
    if (previous.productId !== line.productId || previous.unitId !== line.unitId) {
      parts.push(
        `hàng ${productName(previous.productId)}/${unitName(previous.unitId)} → ${label}`,
      )
    }
    if (Number(previous.qty) !== Number(line.qty)) {
      parts.push(`SL ${qty(previous.qty)} → ${qty(line.qty)}`)
    }
    if (Number(previous.price) !== Number(line.price)) {
      parts.push(`giá ${money(previous.price)} → ${money(line.price)}`)
    }
    if (parts.length > 0) changes.push(`Dòng ${label}: ${parts.join(', ')}`)
  }
  for (const line of oldOrder.lines) {
    if (!newLines.has(line.id)) {
      const prefix = line.type === 'return' ? 'Xóa dòng trả' : 'Xóa dòng'
      changes.push(
        `${prefix} ${productName(line.productId)}/${unitName(line.unitId)}: ${qty(line.qty)} x ${money(line.price)}`,
      )
    }
  }

  return {
    oldTotal: oldOrder.total,
    newTotal: next.total,
    diff: next.total - oldOrder.total,
    changes,
  }
}
