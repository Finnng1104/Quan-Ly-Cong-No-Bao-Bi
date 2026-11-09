import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { todayInShopZone } from '../../shared/dates.js'
import {
  isoDateSchema,
  moneySchema,
  nonEmptyText,
  optionalText,
  paginationSchema,
  parseInput,
} from '../../shared/validation.js'
import { customerBalance } from '../ledger/queries.js'
import {
  deleteCustomer,
  insertCustomer,
  listCustomers,
  requireCustomer,
  toCustomerDto,
  updateCustomer,
  type CustomerInput,
  type CustomerRow,
} from './service.js'

const openingDebtSchema = z.object({
  amount: moneySchema,
  date: isoDateSchema.optional(),
})

const createSchema = z.object({
  name: nonEmptyText(200),
  phone: optionalText(50).default(''),
  address: optionalText(300).default(''),
  note: optionalText(1000).default(''),
  openingDebt: openingDebtSchema.optional(),
})

const updateSchema = z.object({
  name: nonEmptyText(200).optional(),
  phone: optionalText(50).optional(),
  address: optionalText(300).optional(),
  note: optionalText(1000).optional(),
  openingDebt: openingDebtSchema.optional(),
})

const listSchema = paginationSchema.extend({
  q: z.string().max(100).default(''),
  sort: z.enum(['debt_desc', 'debt_asc']).default('debt_desc'),
  asOf: isoDateSchema.optional(),
  // Query strings carry no booleans; "1" keeps only customers who owe money.
  debtOnly: z.enum(['0', '1']).default('0'),
})

const asOfSchema = z.object({ asOf: isoDateSchema.optional() })

export function registerCustomerRoutes(app: FastifyInstance, ctx: AppContext): void {
  const today = (): string => todayInShopZone(ctx.now())

  app.get('/api/customers', async (request) => {
    const { branchId } = authorize(request, 'customers:read')
    const query = parseInput(listSchema, request.query)
    return listCustomers(ctx.db, branchId, {
      q: query.q,
      sort: query.sort,
      asOf: query.asOf ?? today(),
      debtOnly: query.debtOnly === '1',
      limit: query.limit,
      offset: query.offset,
    })
  })

  app.post('/api/customers', async (request, reply) => {
    const { branchId } = authorize(request, 'customers:write')
    const body = parseInput(createSchema, request.body)

    const row = insertCustomer(
      ctx.db,
      branchId,
      {
        name: body.name,
        phone: body.phone,
        address: body.address,
        note: body.note,
        openingDebt: {
          amount: body.openingDebt?.amount ?? 0,
          // Without a date the debt starts today, like the web app did.
          date: body.openingDebt?.date ?? today(),
        },
      },
      ctx.now().toISOString(),
    )
    reply.status(201)
    return toCustomerDto(row)
  })

  app.get('/api/customers/:id', async (request) => {
    const { branchId } = authorize(request, 'customers:read')
    const { id } = request.params as { id: string }
    const { asOf } = parseInput(asOfSchema, request.query)

    const row = requireCustomer(ctx.db, branchId, id)
    return { ...toCustomerDto(row), balance: customerBalance(ctx.db, branchId, id, asOf ?? today()) }
  })

  app.patch('/api/customers/:id', async (request) => {
    const { branchId } = authorize(request, 'customers:write')
    const { id } = request.params as { id: string }
    const body = parseInput(updateSchema, request.body)

    const current: CustomerRow = requireCustomer(ctx.db, branchId, id)
    const merged: CustomerInput = {
      name: body.name ?? current.name,
      phone: body.phone ?? current.phone,
      address: body.address ?? current.address,
      note: body.note ?? current.note,
      openingDebt: {
        amount: body.openingDebt?.amount ?? current.opening_debt_amount,
        date: body.openingDebt?.date ?? current.opening_debt_date,
      },
    }
    return toCustomerDto(updateCustomer(ctx.db, branchId, id, merged, ctx.now().toISOString()))
  })

  app.delete('/api/customers/:id', async (request, reply) => {
    const { branchId } = authorize(request, 'customers:write')
    const { id } = request.params as { id: string }
    deleteCustomer(ctx.db, branchId, id, ctx.now().toISOString())
    reply.status(204)
  })
}
