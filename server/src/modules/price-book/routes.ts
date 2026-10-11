import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { idSchema, parseInput, priceSchema } from '../../shared/validation.js'
import { findCatalogItem } from '../catalog/routes.js'
import { requireCustomer } from '../customers/service.js'

interface PriceRow {
  id: string
  product_id: string
  unit_id: string
  price: number
}

export interface PriceDto {
  id: string
  productId: string
  unitId: string
  price: number
}

const toDto = (row: PriceRow): PriceDto => ({
  id: row.id,
  productId: row.product_id,
  unitId: row.unit_id,
  price: row.price,
})

const upsertSchema = z.object({
  productId: idSchema,
  unitId: idSchema,
  price: priceSchema,
})

export function registerPriceBookRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Prices of a customer, hiding entries whose product or unit has been deleted. */
  const listPrices = (branchId: string, customerId: string): PriceDto[] => {
    const rows = ctx.db
      .prepare(
        `SELECT pb.id, pb.product_id, pb.unit_id, pb.price
           FROM price_book pb
           JOIN products p ON p.id = pb.product_id AND p.deleted_at IS NULL
           JOIN units u ON u.id = pb.unit_id AND u.deleted_at IS NULL
          WHERE pb.branch_id = ? AND pb.customer_id = ?
          ORDER BY pb.rowid`,
      )
      .all(branchId, customerId) as PriceRow[]
    return rows.map(toDto)
  }

  app.get('/api/customers/:id/prices', async (request) => {
    const { branchId } = authorize(request, 'prices:read')
    const { id } = request.params as { id: string }
    requireCustomer(ctx.db, branchId, id)
    return { items: listPrices(branchId, id) }
  })

  app.put('/api/customers/:id/prices', async (request) => {
    const { branchId } = authorize(request, 'prices:write')
    const { id: customerId } = request.params as { id: string }
    const body = parseInput(upsertSchema, request.body)
    requireCustomer(ctx.db, branchId, customerId)

    const product = findCatalogItem(ctx, 'products', branchId, body.productId)
    if (!product || product.deleted_at) {
      throw new AppError('VALIDATION_ERROR', 'Sản phẩm không tồn tại', { productId: 'Sản phẩm không tồn tại' })
    }
    const unit = findCatalogItem(ctx, 'units', branchId, body.unitId)
    if (!unit || unit.deleted_at) {
      throw new AppError('VALIDATION_ERROR', 'Quy cách không tồn tại', { unitId: 'Quy cách không tồn tại' })
    }

    const existing = ctx.db
      .prepare('SELECT id FROM price_book WHERE customer_id = ? AND product_id = ? AND unit_id = ?')
      .get(customerId, body.productId, body.unitId) as { id: string } | undefined

    const id = existing?.id ?? randomUUID()
    if (existing) {
      ctx.db.prepare('UPDATE price_book SET price = ? WHERE id = ?').run(body.price, id)
    } else {
      ctx.db
        .prepare(
          `INSERT INTO price_book (id, branch_id, customer_id, product_id, unit_id, price)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, branchId, customerId, body.productId, body.unitId, body.price)
    }
    return { id, productId: body.productId, unitId: body.unitId, price: body.price } satisfies PriceDto
  })

  app.delete('/api/prices/:id', async (request) => {
    const { branchId } = authorize(request, 'prices:write')
    const { id } = request.params as { id: string }
    const result = ctx.db.prepare('DELETE FROM price_book WHERE id = ? AND branch_id = ?').run(id, branchId)
    if (result.changes === 0) throw new AppError('NOT_FOUND', 'Không tìm thấy giá')
    return { ok: true }
  })

  app.post('/api/customers/:id/prices/copy-from/:fromId', async (request) => {
    const { branchId } = authorize(request, 'prices:write')
    const { id: toId, fromId } = request.params as { id: string; fromId: string }
    requireCustomer(ctx.db, branchId, toId)
    requireCustomer(ctx.db, branchId, fromId)

    if (toId !== fromId) {
      const copy = ctx.db.transaction(() => {
        // Copying replaces the target's list entirely, exactly like the web app.
        ctx.db.prepare('DELETE FROM price_book WHERE branch_id = ? AND customer_id = ?').run(branchId, toId)
        const source = ctx.db
          .prepare(
            `SELECT product_id, unit_id, price FROM price_book
              WHERE branch_id = ? AND customer_id = ? ORDER BY rowid`,
          )
          .all(branchId, fromId) as { product_id: string; unit_id: string; price: number }[]
        const insert = ctx.db.prepare(
          `INSERT INTO price_book (id, branch_id, customer_id, product_id, unit_id, price)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        for (const entry of source) {
          insert.run(randomUUID(), branchId, toId, entry.product_id, entry.unit_id, entry.price)
        }
      })
      copy.immediate()
    }
    return { items: listPrices(branchId, toId) }
  })
}
