import { randomUUID } from 'node:crypto'
import type { Database } from '../../db/client.js'
import { AppError } from '../../shared/errors.js'
import { normalizeSearch } from '../../shared/text.js'

export interface CustomerRow {
  id: string
  branch_id: string
  name: string
  search_text: string
  phone: string
  address: string
  note: string
  opening_debt_amount: number
  opening_debt_date: string
  created_at: string
  updated_at: string
}

export interface CustomerDto {
  id: string
  name: string
  phone: string
  address: string
  note: string
  openingDebt: { amount: number; date: string }
}

export function toCustomerDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    note: row.note,
    openingDebt: { amount: row.opening_debt_amount, date: row.opening_debt_date },
  }
}

export function findCustomer(db: Database, branchId: string, id: string): CustomerRow | undefined {
  return db
    .prepare('SELECT * FROM customers WHERE id = ? AND branch_id = ? AND deleted_at IS NULL')
    .get(id, branchId) as CustomerRow | undefined
}

export function requireCustomer(db: Database, branchId: string, id: string): CustomerRow {
  const row = findCustomer(db, branchId, id)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy khách hàng')
  return row
}

export interface CustomerInput {
  name: string
  phone: string
  address: string
  note: string
  openingDebt: { amount: number; date: string }
}

// Search must find a customer by name or phone, typed with or without diacritics.
const searchTextOf = (name: string, phone: string): string => normalizeSearch(`${name} ${phone}`)

export function insertCustomer(
  db: Database,
  branchId: string,
  input: CustomerInput,
  nowIso: string,
): CustomerRow {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO customers
       (id, branch_id, name, search_text, phone, address, note,
        opening_debt_amount, opening_debt_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    branchId,
    input.name,
    searchTextOf(input.name, input.phone),
    input.phone,
    input.address,
    input.note,
    input.openingDebt.amount,
    input.openingDebt.date,
    nowIso,
    nowIso,
  )
  return requireCustomer(db, branchId, id)
}

export function updateCustomer(
  db: Database,
  branchId: string,
  id: string,
  input: CustomerInput,
  nowIso: string,
): CustomerRow {
  db.prepare(
    `UPDATE customers
        SET name = ?, search_text = ?, phone = ?, address = ?, note = ?,
            opening_debt_amount = ?, opening_debt_date = ?, updated_at = ?
      WHERE id = ? AND branch_id = ?`,
  ).run(
    input.name,
    searchTextOf(input.name, input.phone),
    input.phone,
    input.address,
    input.note,
    input.openingDebt.amount,
    input.openingDebt.date,
    nowIso,
    id,
    branchId,
  )
  return requireCustomer(db, branchId, id)
}

/**
 * Soft delete: the customer's orders, payments and returns stay in the database, but the customer
 * leaves every list and debt total (see the ledger_events view).
 */
export function deleteCustomer(db: Database, branchId: string, id: string, nowIso: string): void {
  requireCustomer(db, branchId, id)
  db.prepare('UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ? AND branch_id = ?').run(
    nowIso,
    nowIso,
    id,
    branchId,
  )
}

export type CustomerSort = 'debt_desc' | 'debt_asc'

export interface ListCustomersParams {
  q: string
  sort: CustomerSort
  asOf: string
  /** Only customers who owe money on `asOf`, like the dashboard's "còn nợ" count. */
  debtOnly: boolean
  limit: number
  offset: number
}

export interface CustomerListItem extends CustomerDto {
  balance: number
  act: { up: number; down: number }
  /** How many price list entries the customer has (shown when choosing a list to copy from). */
  priceCount: number
}

export interface CustomerList {
  items: CustomerListItem[]
  total: number
  summary: { totalDebt: number }
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

interface ListRow extends CustomerRow {
  balance: number
  act_up: number
  act_down: number
  price_count: number
}

/**
 * Customers with their debt on `asOf` and that day's activity, sorted and paged in SQL.
 * `summary.totalDebt` covers every customer matching the search, not just the returned page.
 */
export function listCustomers(db: Database, branchId: string, params: ListCustomersParams): CustomerList {
  const needle = normalizeSearch(params.q)
  const like = needle === '' ? '%' : `%${escapeLike(needle)}%`
  const direction = params.sort === 'debt_asc' ? 'ASC' : 'DESC'

  const base = `
    WITH bal AS (
      SELECT customer_id, SUM(delta) AS balance
        FROM ledger_events
       WHERE branch_id = @branchId AND date <= @asOf
       GROUP BY customer_id
    ),
    act AS (
      SELECT customer_id, SUM(up) AS up, SUM(down) AS down FROM (
        SELECT customer_id, total AS up, 0 AS down FROM orders
         WHERE branch_id = @branchId AND deleted_at IS NULL AND date = @asOf
        UNION ALL
        SELECT customer_id, 0, total FROM returns
         WHERE branch_id = @branchId AND deleted_at IS NULL AND date = @asOf
        UNION ALL
        SELECT customer_id, 0, amount FROM payments
         WHERE branch_id = @branchId AND deleted_at IS NULL AND date = @asOf
      ) GROUP BY customer_id
    ),
    listing AS (
      SELECT c.*, COALESCE(bal.balance, 0) AS balance,
             COALESCE(act.up, 0) AS act_up, COALESCE(act.down, 0) AS act_down,
             (SELECT COUNT(*) FROM price_book pb
                JOIN products p ON p.id = pb.product_id AND p.deleted_at IS NULL
                JOIN units u ON u.id = pb.unit_id AND u.deleted_at IS NULL
               WHERE pb.customer_id = c.id) AS price_count
        FROM customers c
        LEFT JOIN bal ON bal.customer_id = c.id
        LEFT JOIN act ON act.customer_id = c.id
       WHERE c.branch_id = @branchId AND c.deleted_at IS NULL AND c.search_text LIKE @like ESCAPE '\\'
         AND (@debtOnly = 0 OR COALESCE(bal.balance, 0) > 0)
    )`

  const named = { branchId, asOf: params.asOf, like, debtOnly: params.debtOnly ? 1 : 0 }

  const rows = db
    .prepare(
      `${base}
       SELECT * FROM listing
        ORDER BY balance ${direction}, name COLLATE NOCASE ASC, id ASC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...named, limit: params.limit, offset: params.offset }) as ListRow[]

  const summary = db
    .prepare(`${base} SELECT COUNT(*) AS total, COALESCE(SUM(balance), 0) AS totalDebt FROM listing`)
    .get(named) as { total: number; totalDebt: number }

  return {
    items: rows.map((row) => ({
      ...toCustomerDto(row),
      balance: row.balance,
      act: { up: row.act_up, down: row.act_down },
      priceCount: row.price_count,
    })),
    total: summary.total,
    summary: { totalDebt: summary.totalDebt },
  }
}
