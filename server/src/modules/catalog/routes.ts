import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { nonEmptyText, parseInput } from '../../shared/validation.js'

// Products and units are the same kind of thing (a named, soft-deletable list entry).
// The table name comes from this fixed map, never from user input.
const CATALOGS = {
  products: { table: 'products', label: 'sản phẩm' },
  units: { table: 'units', label: 'quy cách' },
} as const

type CatalogKind = keyof typeof CATALOGS

interface CatalogRow {
  id: string
  name: string
}

const bodySchema = z.object({ name: nonEmptyText(200) })

export interface CatalogItem {
  id: string
  name: string
}

/** Looks an item up regardless of soft deletion (old orders still point at deleted items). */
export function findCatalogItem(
  ctx: AppContext,
  kind: CatalogKind,
  branchId: string,
  id: string,
): (CatalogRow & { deleted_at: string | null }) | undefined {
  const { table } = CATALOGS[kind]
  return ctx.db
    .prepare(`SELECT id, name, deleted_at FROM ${table} WHERE id = ? AND branch_id = ?`)
    .get(id, branchId) as (CatalogRow & { deleted_at: string | null }) | undefined
}

function registerCatalog(app: FastifyInstance, ctx: AppContext, kind: CatalogKind): void {
  const { table, label } = CATALOGS[kind]
  const base = `/api/${kind}`

  app.get(base, async (request) => {
    const { branchId } = authorize(request, 'catalog:read')
    // rowid keeps creation order, which is the order the web app shows.
    const items = ctx.db
      .prepare(`SELECT id, name FROM ${table} WHERE branch_id = ? AND deleted_at IS NULL ORDER BY rowid`)
      .all(branchId) as CatalogItem[]
    return { items }
  })

  app.post(base, async (request, reply) => {
    const { branchId } = authorize(request, 'catalog:write')
    const body = parseInput(bodySchema, request.body)
    const id = randomUUID()
    ctx.db.prepare(`INSERT INTO ${table} (id, branch_id, name) VALUES (?, ?, ?)`).run(id, branchId, body.name)
    reply.status(201)
    return { id, name: body.name } satisfies CatalogItem
  })

  app.patch(`${base}/:id`, async (request) => {
    const { branchId } = authorize(request, 'catalog:write')
    const { id } = request.params as { id: string }
    const body = parseInput(bodySchema, request.body)

    const item = findCatalogItem(ctx, kind, branchId, id)
    if (!item || item.deleted_at) throw new AppError('NOT_FOUND', `Không tìm thấy ${label}`)

    ctx.db.prepare(`UPDATE ${table} SET name = ? WHERE id = ? AND branch_id = ?`).run(body.name, id, branchId)
    return { id, name: body.name } satisfies CatalogItem
  })

  app.delete(`${base}/:id`, async (request) => {
    const { branchId } = authorize(request, 'catalog:write')
    const { id } = request.params as { id: string }

    const item = findCatalogItem(ctx, kind, branchId, id)
    if (!item) throw new AppError('NOT_FOUND', `Không tìm thấy ${label}`)

    // Soft delete: orders and price lists keep pointing at it so old documents stay readable.
    ctx.db
      .prepare(`UPDATE ${table} SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND branch_id = ?`)
      .run(ctx.now().toISOString(), id, branchId)
    return { ok: true }
  })
}

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  registerCatalog(app, ctx, 'products')
  registerCatalog(app, ctx, 'units')
}
