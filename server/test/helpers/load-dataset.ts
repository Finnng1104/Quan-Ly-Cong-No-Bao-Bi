import { randomUUID } from 'node:crypto'
import type { Database } from '../../src/db/client.js'
import type { LedgerData } from '../../src/modules/ledger/types.js'
import { lineAmount, toQtyMilli } from '../../src/shared/money.js'

const BRANCH = 'main'
const SEEDED_AT = '2026-09-01T00:00:00.000Z'

/**
 * Writes an in-memory ledger dataset straight into the database tables, bypassing the API.
 * Documents keep exactly the ids, dates, seqs and totals given, so SQL read models can be
 * compared with the pure ledger functions on identical data.
 */
export function loadDataset(
  db: Database,
  data: LedgerData,
  catalog: { productIds: string[]; unitIds: string[] },
): void {
  const run = db.transaction(() => {
    for (const id of catalog.productIds) {
      db.prepare('INSERT INTO products (id, branch_id, name) VALUES (?, ?, ?)').run(id, BRANCH, `Product ${id}`)
    }
    for (const id of catalog.unitIds) {
      db.prepare('INSERT INTO units (id, branch_id, name) VALUES (?, ?, ?)').run(id, BRANCH, `Unit ${id}`)
    }

    for (const customer of data.customers) {
      db.prepare(
        `INSERT INTO customers
           (id, branch_id, name, search_text, phone, opening_debt_amount, opening_debt_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        customer.id,
        BRANCH,
        customer.name ?? customer.id,
        (customer.name ?? customer.id).toLowerCase(),
        customer.phone ?? '',
        customer.openingDebt?.amount ?? 0,
        customer.openingDebt?.date ?? '2026-09-01',
        SEEDED_AT,
        SEEDED_AT,
      )
    }

    for (const order of data.orders) {
      db.prepare(
        `INSERT INTO orders
           (id, branch_id, code, customer_id, date, seq, vat_rate_bp, vat_amount, vat_manual,
            fees_total, total, note, version, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 1, ?, ?, ?)`,
      ).run(
        order.id,
        BRANCH,
        order.code,
        order.customerId,
        order.date,
        order.seq ?? 0,
        order.vat ? Math.round((order.vat.rate ?? 8) * 100) : null,
        order.vat?.amount ?? 0,
        order.vat?.manual ? 1 : 0,
        (order.fees ?? []).reduce((sum, fee) => sum + fee.amount, 0),
        order.total,
        SEEDED_AT,
        SEEDED_AT,
        order.deletedAt ?? null,
      )
      order.lines.forEach((line, position) => {
        const qtyMilli = toQtyMilli(line.qty)
        db.prepare(
          `INSERT INTO order_lines (id, order_id, position, type, product_id, unit_id, qty_milli, price, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          line.id,
          order.id,
          position,
          line.type ?? 'sell',
          line.productId,
          line.unitId,
          qtyMilli,
          line.price,
          lineAmount(qtyMilli, line.price),
        )
      })
      ;(order.fees ?? []).forEach((fee, position) => {
        db.prepare('INSERT INTO order_fees (id, order_id, position, name, amount) VALUES (?, ?, ?, ?, ?)').run(
          fee.id,
          order.id,
          position,
          fee.name,
          fee.amount,
        )
      })
    }

    data.returns.forEach((goodsReturn, index) => {
      db.prepare(
        `INSERT INTO returns (id, branch_id, code, customer_id, date, seq, total, reason, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      ).run(
        goodsReturn.id,
        BRANCH,
        `TH-${String(index + 1).padStart(4, '0')}`,
        goodsReturn.customerId,
        goodsReturn.date,
        goodsReturn.seq ?? 0,
        goodsReturn.total,
        SEEDED_AT,
        goodsReturn.deletedAt ?? null,
      )
      goodsReturn.lines.forEach((line, position) => {
        const qtyMilli = toQtyMilli(line.qty)
        db.prepare(
          `INSERT INTO return_lines (id, return_id, position, product_id, unit_id, qty_milli, price, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), goodsReturn.id, position, line.productId, line.unitId, qtyMilli, line.price ?? 0, lineAmount(qtyMilli, line.price ?? 0))
      })
    })

    data.payments.forEach((payment, index) => {
      db.prepare(
        `INSERT INTO payments (id, branch_id, code, customer_id, date, seq, amount, note, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      ).run(
        payment.id,
        BRANCH,
        `TT-${String(index + 1).padStart(4, '0')}`,
        payment.customerId,
        payment.date,
        payment.seq ?? 0,
        payment.amount,
        SEEDED_AT,
        payment.deletedAt ?? null,
      )
    })

    ;(data.adjustments ?? []).forEach((adjustment, index) => {
      db.prepare(
        `INSERT INTO adjustments (id, branch_id, code, customer_id, date, seq, amount, note, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        adjustment.id,
        BRANCH,
        `PS-${String(index + 1).padStart(4, '0')}`,
        adjustment.customerId,
        adjustment.date,
        adjustment.seq ?? 0,
        adjustment.amount,
        adjustment.note ?? '',
        SEEDED_AT,
        adjustment.deletedAt ?? null,
      )
    })
  })
  run()
}
