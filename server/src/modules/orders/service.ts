import { randomUUID } from 'node:crypto'
import type { AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { formatCode, nextCounter } from '../../shared/counters.js'
import {
  bpToPercent,
  computeOrderTotals,
  fromQtyMilli,
  MoneyError,
  percentToBp,
  type OrderLineType,
  type OrderTotals,
} from '../../shared/money.js'
import { getDefaultVatRateBp } from '../settings/routes.js'
import { requireCustomer } from '../customers/service.js'
import { fieldError, validateLineItem } from '../documents/line-validation.js'
import { diffOrders, type DiffableOrder } from '../ledger/order-diff.js'

// ---------- row and DTO shapes ----------

interface OrderRow {
  id: string
  branch_id: string
  code: string
  customer_id: string
  date: string
  seq: number
  vat_rate_bp: number | null
  vat_amount: number
  vat_manual: number
  fees_total: number
  total: number
  note: string
  version: number
  created_at: string
  updated_at: string
  last_edit_at: string | null
  deleted_at: string | null
}

interface LineRow {
  id: string
  type: OrderLineType
  product_id: string
  unit_id: string
  qty_milli: number
  price: number
  amount: number
}

interface FeeRow {
  id: string
  name: string
  amount: number
}

interface EditRow {
  edited_at: string
  old_total: number
  new_total: number
  diff: number
  changes: string
}

export interface OrderLineDto {
  id: string
  type: OrderLineType
  productId: string
  unitId: string
  qty: number
  price: number
  amount: number
}

export interface OrderDto {
  id: string
  code: string
  customerId: string
  date: string
  seq: number
  lines: OrderLineDto[]
  vat: { ratePercent: number; amount: number; manual: boolean } | null
  fees: { id: string; name: string; amount: number }[]
  note: string
  total: number
  version: number
  createdAt: string
  lastEditAt: string | null
  deletedAt: string | null
}

export interface OrderEditDto {
  editedAt: string
  oldTotal: number
  newTotal: number
  diff: number
  changes: string[]
}

// ---------- input shapes (already validated by the route) ----------

export interface OrderLineInput {
  id?: string | undefined
  type: OrderLineType
  productId: string
  unitId: string
  qty: number
  price: number
}

export interface OrderInput {
  customerId: string
  date: string
  lines: OrderLineInput[]
  vat: { ratePercent?: number | undefined; amount?: number | undefined } | null
  fees: { id?: string | undefined; name: string; amount: number }[]
  note: string
}

interface PreparedLine {
  id: string
  type: OrderLineType
  productId: string
  unitId: string
  qtyMilli: number
  qty: number
  price: number
  amount: number
}

interface PreparedFee {
  id: string
  name: string
  amount: number
}

interface PreparedOrder {
  customerId: string
  date: string
  note: string
  lines: PreparedLine[]
  fees: PreparedFee[]
  totals: OrderTotals
}

const DEFAULT_FEE_NAME = 'Chi phí'

// ---------- reading ----------

function findOrderRow(ctx: AppContext, branchId: string, id: string): OrderRow | undefined {
  return ctx.db.prepare('SELECT * FROM orders WHERE id = ? AND branch_id = ?').get(id, branchId) as
    | OrderRow
    | undefined
}

export function requireOrderRow(ctx: AppContext, branchId: string, id: string): OrderRow {
  const row = findOrderRow(ctx, branchId, id)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy đơn hàng')
  return row
}

function readLines(ctx: AppContext, orderId: string): LineRow[] {
  return ctx.db
    .prepare(
      `SELECT id, type, product_id, unit_id, qty_milli, price, amount
         FROM order_lines WHERE order_id = ? ORDER BY position`,
    )
    .all(orderId) as LineRow[]
}

function readFees(ctx: AppContext, orderId: string): FeeRow[] {
  return ctx.db
    .prepare('SELECT id, name, amount FROM order_fees WHERE order_id = ? ORDER BY position')
    .all(orderId) as FeeRow[]
}

export function toOrderDto(ctx: AppContext, row: OrderRow): OrderDto {
  return {
    id: row.id,
    code: row.code,
    customerId: row.customer_id,
    date: row.date,
    seq: row.seq,
    lines: readLines(ctx, row.id).map((line) => ({
      id: line.id,
      type: line.type,
      productId: line.product_id,
      unitId: line.unit_id,
      qty: fromQtyMilli(line.qty_milli),
      price: line.price,
      amount: line.amount,
    })),
    vat:
      row.vat_rate_bp === null
        ? null
        : {
            ratePercent: bpToPercent(row.vat_rate_bp),
            amount: row.vat_amount,
            manual: row.vat_manual === 1,
          },
    fees: readFees(ctx, row.id),
    note: row.note,
    total: row.total,
    version: row.version,
    createdAt: row.created_at,
    lastEditAt: row.last_edit_at,
    deletedAt: row.deleted_at,
  }
}

export function readEditHistory(ctx: AppContext, orderId: string): OrderEditDto[] {
  const rows = ctx.db
    .prepare(
      `SELECT edited_at, old_total, new_total, diff, changes
         FROM order_edits WHERE order_id = ? ORDER BY edited_at, rowid`,
    )
    .all(orderId) as EditRow[]
  return rows.map((row) => ({
    editedAt: row.edited_at,
    oldTotal: row.old_total,
    newTotal: row.new_total,
    diff: row.diff,
    changes: JSON.parse(row.changes) as string[],
  }))
}

// ---------- validation and preparation ----------

/**
 * Turns validated input into what will be stored, and computes every amount on the server.
 * `reusableProductIds` / `reusableUnitIds` are items a previous version of the order already
 * used: those may be soft-deleted, new lines may not pick deleted items.
 */
function prepareOrder(
  ctx: AppContext,
  branchId: string,
  input: OrderInput,
  existing: { orderId: string; productIds: Set<string>; unitIds: Set<string> } | null,
): PreparedOrder {
  requireCustomer(ctx.db, branchId, input.customerId)

  const lineIdOwner = ctx.db.prepare('SELECT order_id FROM order_lines WHERE id = ?')

  const lines: PreparedLine[] = input.lines.map((line, index) => {
    const prefix = `lines[${index}]`
    const qtyMilli = validateLineItem(ctx, branchId, line, prefix, existing)

    // A client-chosen line id must not belong to some other order.
    if (line.id) {
      const owner = lineIdOwner.get(line.id) as { order_id: string } | undefined
      if (owner && owner.order_id !== existing?.orderId) {
        throw fieldError(`${prefix}.id`, 'Mã dòng đã được dùng')
      }
    }

    return {
      id: line.id ?? randomUUID(),
      type: line.type,
      productId: line.productId,
      unitId: line.unitId,
      qtyMilli,
      qty: fromQtyMilli(qtyMilli),
      price: line.price,
      amount: 0, // filled below from the computed totals
    }
  })

  const seenLineIds = new Set<string>()
  lines.forEach((line, index) => {
    if (seenLineIds.has(line.id)) throw fieldError(`lines[${index}].id`, 'Mã dòng bị trùng')
    seenLineIds.add(line.id)
  })

  // Fees that are not positive are ignored (they are rows the person cleared in the form).
  const fees: PreparedFee[] = input.fees
    .filter((fee) => fee.amount > 0)
    .map((fee) => ({
      id: fee.id ?? randomUUID(),
      name: fee.name.trim() === '' ? DEFAULT_FEE_NAME : fee.name.trim(),
      amount: fee.amount,
    }))

  let vat: { rateBp: number; amount?: number | undefined } | null = null
  if (input.vat) {
    let rateBp: number
    if (input.vat.ratePercent === undefined) {
      rateBp = getDefaultVatRateBp(ctx, branchId)
    } else {
      try {
        rateBp = percentToBp(input.vat.ratePercent)
      } catch {
        throw fieldError('vat.ratePercent', 'Thuế VAT phải từ 0 đến 100%, tối đa 2 chữ số thập phân')
      }
    }
    vat = { rateBp, amount: input.vat.amount }
  }

  let totals: OrderTotals
  try {
    totals = computeOrderTotals({
      lines: lines.map((line) => ({ type: line.type, qtyMilli: line.qtyMilli, price: line.price })),
      vat,
      fees,
    })
  } catch (error) {
    if (error instanceof MoneyError) throw new AppError('VALIDATION_ERROR', 'Giá trị đơn hàng quá lớn')
    throw error
  }
  lines.forEach((line, index) => {
    line.amount = totals.lineAmounts[index] as number
  })

  return { customerId: input.customerId, date: input.date, note: input.note, lines, fees, totals }
}

// ---------- writing ----------

function writeContent(ctx: AppContext, orderId: string, prepared: PreparedOrder): void {
  const insertLine = ctx.db.prepare(
    `INSERT INTO order_lines (id, order_id, position, type, product_id, unit_id, qty_milli, price, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  prepared.lines.forEach((line, position) => {
    insertLine.run(
      line.id,
      orderId,
      position,
      line.type,
      line.productId,
      line.unitId,
      line.qtyMilli,
      line.price,
      line.amount,
    )
  })

  const insertFee = ctx.db.prepare(
    'INSERT INTO order_fees (id, order_id, position, name, amount) VALUES (?, ?, ?, ?, ?)',
  )
  prepared.fees.forEach((fee, position) => {
    insertFee.run(fee.id, orderId, position, fee.name, fee.amount)
  })
}

export function createOrder(ctx: AppContext, branchId: string, input: OrderInput): OrderDto {
  const prepared = prepareOrder(ctx, branchId, input, null)
  const nowIso = ctx.now().toISOString()
  const id = randomUUID()

  const run = ctx.db.transaction(() => {
    const orderNo = nextCounter(ctx.db, branchId, 'order_no')
    const seq = nextCounter(ctx.db, branchId, 'seq')
    const { totals } = prepared

    ctx.db
      .prepare(
        `INSERT INTO orders
           (id, branch_id, code, customer_id, date, seq, vat_rate_bp, vat_amount, vat_manual,
            fees_total, total, note, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        branchId,
        formatCode('HĐ', orderNo),
        prepared.customerId,
        prepared.date,
        seq,
        totals.vat?.rateBp ?? null,
        totals.vat?.amount ?? 0,
        totals.vat?.manual ? 1 : 0,
        totals.feesTotal,
        totals.total,
        prepared.note,
        nowIso,
        nowIso,
      )
    writeContent(ctx, id, prepared)
  })
  run.immediate()

  return toOrderDto(ctx, requireOrderRow(ctx, branchId, id))
}

function diffableFromRow(ctx: AppContext, row: OrderRow): DiffableOrder {
  return {
    customerId: row.customer_id,
    date: row.date,
    total: row.total,
    note: row.note,
    vat:
      row.vat_rate_bp === null
        ? null
        : { rate: bpToPercent(row.vat_rate_bp), amount: row.vat_amount, manual: row.vat_manual === 1 },
    fees: readFees(ctx, row.id).map((fee) => ({ id: fee.id, name: fee.name, amount: fee.amount })),
    lines: readLines(ctx, row.id).map((line) => ({
      id: line.id,
      type: line.type,
      productId: line.product_id,
      unitId: line.unit_id,
      qty: fromQtyMilli(line.qty_milli),
      price: line.price,
    })),
  }
}

function diffableFromPrepared(prepared: PreparedOrder): DiffableOrder {
  return {
    customerId: prepared.customerId,
    date: prepared.date,
    total: prepared.totals.total,
    note: prepared.note,
    vat: prepared.totals.vat
      ? {
          rate: bpToPercent(prepared.totals.vat.rateBp),
          amount: prepared.totals.vat.amount,
          manual: prepared.totals.vat.manual,
        }
      : null,
    fees: prepared.fees,
    lines: prepared.lines.map((line) => ({
      id: line.id,
      type: line.type,
      productId: line.productId,
      unitId: line.unitId,
      qty: line.qty,
      price: line.price,
    })),
  }
}

/** Names as they are right now, including soft-deleted items, falling back to the id like the app. */
function nameLookups(ctx: AppContext, branchId: string) {
  const nameOf = (table: 'products' | 'units' | 'customers') => {
    const statement = ctx.db.prepare(`SELECT name FROM ${table} WHERE id = ? AND branch_id = ?`)
    return (id: string): string => (statement.get(id, branchId) as { name: string } | undefined)?.name ?? id
  }
  return {
    productName: nameOf('products'),
    unitName: nameOf('units'),
    customerName: nameOf('customers'),
  }
}

export function updateOrder(
  ctx: AppContext,
  branchId: string,
  orderId: string,
  input: OrderInput,
  expectedVersion: number,
): { order: OrderDto; changed: boolean } {
  const row = requireOrderRow(ctx, branchId, orderId)
  if (row.deleted_at) throw new AppError('CONFLICT', 'Đơn đã bị xóa, hãy khôi phục trước khi sửa')
  if (row.version !== expectedVersion) {
    throw new AppError('CONFLICT', 'Đơn đã bị sửa ở nơi khác, vui lòng tải lại')
  }

  const currentLines = readLines(ctx, orderId)
  const prepared = prepareOrder(ctx, branchId, input, {
    orderId,
    productIds: new Set(currentLines.map((line) => line.product_id)),
    unitIds: new Set(currentLines.map((line) => line.unit_id)),
  })

  const before = diffableFromRow(ctx, row)
  const after = diffableFromPrepared(prepared)
  const diff = diffOrders(before, after, nameLookups(ctx, branchId))

  // Saving an order without changing anything must not create a history entry or flag the order
  // as "edited after the last statement" (PLAN D-22).
  if (diff.changes.length === 0) return { order: toOrderDto(ctx, row), changed: false }

  const nowIso = ctx.now().toISOString()
  const run = ctx.db.transaction(() => {
    const { totals } = prepared
    ctx.db
      .prepare(
        `UPDATE orders
            SET customer_id = ?, date = ?, vat_rate_bp = ?, vat_amount = ?, vat_manual = ?,
                fees_total = ?, total = ?, note = ?, version = version + 1,
                updated_at = ?, last_edit_at = ?
          WHERE id = ? AND branch_id = ?`,
      )
      .run(
        prepared.customerId,
        prepared.date,
        totals.vat?.rateBp ?? null,
        totals.vat?.amount ?? 0,
        totals.vat?.manual ? 1 : 0,
        totals.feesTotal,
        totals.total,
        prepared.note,
        nowIso,
        nowIso,
        orderId,
        branchId,
      )
    ctx.db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(orderId)
    ctx.db.prepare('DELETE FROM order_fees WHERE order_id = ?').run(orderId)
    writeContent(ctx, orderId, prepared)

    ctx.db
      .prepare(
        `INSERT INTO order_edits (id, order_id, edited_at, old_total, new_total, diff, changes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        orderId,
        nowIso,
        diff.oldTotal,
        diff.newTotal,
        diff.diff,
        JSON.stringify(diff.changes),
      )
  })
  run.immediate()

  return { order: toOrderDto(ctx, requireOrderRow(ctx, branchId, orderId)), changed: true }
}

export function setOrderDeleted(
  ctx: AppContext,
  branchId: string,
  orderId: string,
  deleted: boolean,
): OrderDto {
  const row = requireOrderRow(ctx, branchId, orderId)
  const nowIso = ctx.now().toISOString()

  ctx.db
    .prepare('UPDATE orders SET deleted_at = ?, updated_at = ? WHERE id = ? AND branch_id = ?')
    .run(deleted ? (row.deleted_at ?? nowIso) : null, nowIso, orderId, branchId)

  return toOrderDto(ctx, requireOrderRow(ctx, branchId, orderId))
}
