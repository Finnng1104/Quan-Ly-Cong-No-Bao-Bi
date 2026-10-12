import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'
import { createWorld, type World } from '../../../test/helpers/world.js'

describe('orders', () => {
  let t: TestApp
  let w: World

  beforeEach(async () => {
    t = await createTestApp() // today in shop time: 2026-10-11
    w = await createWorld(t)
  })

  afterEach(async () => {
    await t.close()
  })

  const line = (over: Record<string, unknown> = {}) => ({
    productId: w.productId,
    unitId: w.unitId,
    qty: 20,
    price: 500,
    ...over,
  })

  const orderBody = (over: Record<string, unknown> = {}) => ({
    customerId: w.customerId,
    date: '2026-10-08',
    lines: [line(), line({ productId: w.secondProductId, qty: 5 })],
    ...over,
  })

  const createOrder = async (over: Record<string, unknown> = {}) => {
    const response = await t.api.post('/api/orders', orderBody(over))
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body
  }

  describe('creating', () => {
    it('numbers the order, computes the amounts, and starts at version 1', async () => {
      const order = await createOrder()

      expect(order).toMatchObject({
        code: 'HĐ-0001',
        seq: 1,
        total: 12500, // 20 × 500 + 5 × 500
        version: 1,
        vat: null,
        fees: [],
        note: '',
        deletedAt: null,
        lastEditAt: null,
      })
      expect(order.lines.map((l: { amount: number }) => l.amount)).toEqual([10000, 2500])
      expect(order.lines.every((l: { type: string }) => l.type === 'sell')).toBe(true)
    })

    it('gives consecutive codes and a global sequence shared with other documents', async () => {
      const first = await createOrder()
      await t.api.post('/api/payments', { customerId: w.customerId, date: '2026-10-08', amount: 1000 })
      const second = await createOrder()

      expect(first.code).toBe('HĐ-0001')
      expect(second.code).toBe('HĐ-0002')
      expect(second.seq).toBe(3) // the payment took seq 2
    })

    it('ignores totals and amounts sent by the client', async () => {
      const response = await t.api.post('/api/orders', {
        ...orderBody(),
        total: 1,
        lines: [{ ...line(), amount: 1 }],
      })

      expect(response.status).toBe(201)
      expect(response.body.total).toBe(10000)
    })

    it('subtracts return lines from the total', async () => {
      const order = await createOrder({
        lines: [line({ qty: 20 }), line({ productId: w.secondProductId, qty: 5, type: 'return' })],
      })

      expect(order.total).toBe(10000 - 2500)
    })

    it('computes 8% VAT on sold goods only, using the shop default rate', async () => {
      const order = await createOrder({
        lines: [line({ qty: 10, price: 1000 }), line({ qty: 2, price: 500, type: 'return' })],
        vat: {},
      })

      expect(order.vat).toEqual({ ratePercent: 8, amount: 800, manual: false })
      expect(order.total).toBe(10000 - 1000 + 800)
    })

    it('uses an explicit rate, and a hand-typed amount as is', async () => {
      const rate = await createOrder({ lines: [line({ qty: 10, price: 1000 })], vat: { ratePercent: 10 } })
      const manual = await createOrder({
        lines: [line({ qty: 10, price: 1000 })],
        vat: { ratePercent: 8, amount: 3000 },
      })

      expect(rate.vat).toEqual({ ratePercent: 10, amount: 1000, manual: false })
      expect(manual.vat).toEqual({ ratePercent: 8, amount: 3000, manual: true })
      expect(manual.total).toBe(13000)
    })

    it('follows a changed default VAT rate from the settings', async () => {
      await t.api.patch('/api/settings', { vatRatePercent: 5 })

      const order = await createOrder({ lines: [line({ qty: 10, price: 1000 })], vat: {} })

      expect(order.vat).toMatchObject({ ratePercent: 5, amount: 500 })
    })

    it('adds fees, drops empty ones, and names unnamed ones', async () => {
      const order = await createOrder({
        lines: [line({ qty: 10, price: 1000 })],
        fees: [{ name: 'Tiền ship', amount: 30000 }, { name: '', amount: 15000 }, { name: 'Zero', amount: 0 }],
      })

      expect(order.total).toBe(10000 + 45000)
      expect(order.fees.map((f: { name: string }) => f.name)).toEqual(['Tiền ship', 'Chi phí'])
    })

    it('keeps decimal quantities exact', async () => {
      const order = await createOrder({ lines: [line({ qty: 1.5, price: 18000 })] })

      expect(order.lines[0]).toMatchObject({ qty: 1.5, amount: 27000 })
    })

    it('rounds half up where floating point would not (1,005 × 100)', async () => {
      const order = await createOrder({ lines: [line({ qty: 1.005, price: 100 })] })

      expect(order.lines[0].amount).toBe(101)
    })

    it('can be negative when returns exceed sales', async () => {
      const order = await createOrder({ lines: [line({ qty: 1, price: 2500, type: 'return' })] })

      expect(order.total).toBe(-2500)
    })
  })

  describe('validation', () => {
    const expectFieldError = async (over: Record<string, unknown>, field: string) => {
      const response = await t.api.post('/api/orders', orderBody(over))
      expect(response.status).toBe(400)
      expect(response.body.error.fields).toHaveProperty([field])
    }

    it('needs at least one line', async () => {
      await expectFieldError({ lines: [] }, 'lines')
    })

    it('rejects a quantity of zero or with more than 3 decimals', async () => {
      await expectFieldError({ lines: [line({ qty: 0 })] }, 'lines[0].qty')
      await expectFieldError({ lines: [line({ qty: 1.0005 })] }, 'lines[0].qty')
    })

    it('rejects a negative or fractional price', async () => {
      await expectFieldError({ lines: [line({ price: -1 })] }, 'lines[0].price')
      await expectFieldError({ lines: [line({ price: 10.5 })] }, 'lines[0].price')
    })

    it('rejects a bad date', async () => {
      await expectFieldError({ date: '2026-02-30' }, 'date')
    })

    it('rejects unknown or deleted products and units', async () => {
      await expectFieldError({ lines: [line({ productId: 'nope' })] }, 'lines[0].productId')
      await expectFieldError({ lines: [line({ unitId: 'nope' })] }, 'lines[0].unitId')

      await t.api.delete(`/api/products/${w.secondProductId}`)
      await expectFieldError({ lines: [line({ productId: w.secondProductId })] }, 'lines[0].productId')
    })

    it('rejects an unknown customer and an invalid VAT rate', async () => {
      expect((await t.api.post('/api/orders', orderBody({ customerId: 'nope' }))).status).toBe(404)
      await expectFieldError({ vat: { ratePercent: 8.005 } }, 'vat.ratePercent')
    })

    it('rejects a line id that belongs to another order', async () => {
      const first = await createOrder()

      const response = await t.api.post(
        '/api/orders',
        orderBody({ lines: [{ ...line(), id: first.lines[0].id }] }),
      )

      expect(response.status).toBe(400)
      expect(response.body.error.fields).toHaveProperty(['lines[0].id'])
    })

    it('rejects duplicate line ids inside one order', async () => {
      const response = await t.api.post(
        '/api/orders',
        orderBody({ lines: [{ ...line(), id: 'same' }, { ...line(), id: 'same' }] }),
      )

      expect(response.status).toBe(400)
    })
  })

  describe('concurrency', () => {
    it('never hands out the same code or sequence twice', async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () => t.api.post('/api/orders', orderBody())),
      )

      expect(results.every((r) => r.status === 201)).toBe(true)
      const codes = new Set(results.map((r) => r.body.code))
      const seqs = new Set(results.map((r) => r.body.seq))
      expect(codes.size).toBe(50)
      expect(seqs.size).toBe(50)
    })
  })

  describe('reading', () => {
    it('shows the debt before and after the order (opening 59.356 + 12.500 = 71.856)', async () => {
      const order = await createOrder()

      const detail = await t.api.get(`/api/orders/${order.id}`)

      expect(detail.body).toMatchObject({ balanceBefore: 59356, balanceAfter: 71856, editHistory: [] })
    })

    it('chains orders of the same day: the later one starts where the earlier one ended', async () => {
      const first = await createOrder()
      const second = await createOrder({ lines: [line({ qty: 10 })] })

      const firstDetail = (await t.api.get(`/api/orders/${first.id}`)).body
      const secondDetail = (await t.api.get(`/api/orders/${second.id}`)).body

      expect(secondDetail.balanceBefore).toBe(firstDetail.balanceAfter)
      expect(secondDetail.balanceAfter).toBe(59356 + 12500 + 5000)
    })

    it('lists newest first, filtered by date and customer, with totals', async () => {
      await createOrder({ date: '2026-10-08' })
      await createOrder({ date: '2026-10-09', lines: [line({ qty: 10 })] })
      await createOrder({ date: '2026-10-09', customerId: w.otherCustomerId, lines: [line({ qty: 2 })] })

      const all = await t.api.get('/api/orders')
      expect(all.body.items.map((o: { date: string }) => o.date)).toEqual([
        '2026-10-09',
        '2026-10-09',
        '2026-10-08',
      ])
      expect(all.body.total).toBe(3)
      expect(all.body.summary.filteredTotal).toBe(10000 + 5000 + 2500 + 1000)

      const byDate = await t.api.get('/api/orders?date=2026-10-09')
      expect(byDate.body.items).toHaveLength(2)
      expect(byDate.body.summary.dayTotal).toBe(5000 + 1000)

      const byCustomer = await t.api.get(`/api/orders?customerId=${w.otherCustomerId}&date=2026-10-09`)
      expect(byCustomer.body.items).toHaveLength(1)
      // The end-of-day figure ignores the customer filter, like the web app.
      expect(byCustomer.body.summary.dayTotal).toBe(5000 + 1000)
    })

    it('reports today (shop time) as the default day total', async () => {
      await createOrder({ date: '2026-10-11', lines: [line({ qty: 2 })] })

      const response = await t.api.get('/api/orders')

      expect(response.body.summary.dayTotal).toBe(1000)
    })

    it('returns 404 for an unknown order', async () => {
      expect((await t.api.get('/api/orders/nope')).status).toBe(404)
    })
  })

  describe('editing', () => {
    const edit = (order: { id: string; version: number }, over: Record<string, unknown> = {}) =>
      t.api.put(`/api/orders/${order.id}`, { ...orderBody(), version: order.version, ...over })

    // Keeps the ids of unchanged lines, which is how the app tells "edited" from "replaced".
    const sameLines = (order: { lines: { id: string; type: string; productId: string; unitId: string; qty: number; price: number }[] }) =>
      order.lines.map(({ id, type, productId, unitId, qty, price }) => ({ id, type, productId, unitId, qty, price }))

    it('requires the current version', async () => {
      const order = await createOrder()

      const missing = await t.api.put(`/api/orders/${order.id}`, orderBody())
      const stale = await edit({ id: order.id, version: 99 })

      expect(missing.status).toBe(400)
      expect(stale.status).toBe(409)
      expect(stale.body).toMatchObject({ error: { code: 'CONFLICT' } })
    })

    it('does nothing when nothing changed: no history, no version bump, no "edited" flag', async () => {
      const order = await createOrder()

      const response = await edit(order, { lines: sameLines(order) })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ version: 1, lastEditAt: null })
      const detail = await t.api.get(`/api/orders/${order.id}`)
      expect(detail.body.editHistory).toEqual([])
    })

    it('records a Vietnamese history entry, bumps the version and updates the total', async () => {
      const order = await createOrder()
      const lines = sameLines(order)
      lines[0] = { ...(lines[0] as (typeof lines)[number]), qty: 30 }

      const response = await edit(order, { lines })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ version: 2, total: 17500 })
      expect(response.body.lastEditAt).not.toBeNull()

      const detail = (await t.api.get(`/api/orders/${order.id}`)).body
      expect(detail.editHistory).toHaveLength(1)
      expect(detail.editHistory[0]).toMatchObject({ oldTotal: 12500, newTotal: 17500, diff: 5000 })
      expect(detail.editHistory[0].changes).toEqual(['Dòng Bao kiếng / Cây: SL 20 → 30'])
    })

    it('describes date, VAT, fee, note and line additions and removals', async () => {
      const order = await createOrder()
      const [first] = sameLines(order)

      const response = await edit(order, {
        date: '2026-10-09',
        note: 'giao sáng',
        vat: { ratePercent: 8 },
        fees: [{ name: 'Tiền ship', amount: 25000 }],
        lines: [first, line({ productId: w.secondProductId, qty: 3, price: 600, type: 'return' })],
      })
      expect(response.status).toBe(200)

      const { changes } = (await t.api.get(`/api/orders/${order.id}`)).body.editHistory[0]
      expect(changes).toEqual([
        'Đổi ngày: 08/10/2026 → 09/10/2026',
        'Thêm tiền VAT 8%: +800',
        'Đổi ghi chú đơn',
        'Thêm phí "Tiền ship": +25.000',
        'Thêm dòng trả Giấy A6 / Cây: 3 x 600',
        'Xóa dòng Giấy A6/Cây: 5 x 500',
      ])
    })

    it('can move an order to another customer', async () => {
      const order = await createOrder()

      const response = await edit(order, { customerId: w.otherCustomerId, lines: sameLines(order) })

      expect(response.body.customerId).toBe(w.otherCustomerId)
      const { changes } = (await t.api.get(`/api/orders/${order.id}`)).body.editHistory[0]
      expect(changes).toEqual(['Đổi khách: Thanh Nhi → Ông A'])
    })

    it('still allows a line that uses a product deleted since', async () => {
      const order = await createOrder()
      await t.api.delete(`/api/products/${w.productId}`)

      const lines = sameLines(order)
      lines[1] = { ...(lines[1] as (typeof lines)[number]), qty: 6 }
      const response = await edit(order, { lines })

      expect(response.status).toBe(200)
    })

    it('changes every later balance, since debt is always recomputed', async () => {
      const order = await createOrder()
      await t.api.post('/api/payments', { customerId: w.customerId, date: '2026-10-09', amount: 30000 })
      const before = (await t.api.get(`/api/customers/${w.customerId}?asOf=2026-10-10`)).body.balance
      expect(before).toBe(41856)

      const lines = sameLines(order)
      lines[0] = { ...(lines[0] as (typeof lines)[number]), qty: 30 }
      await edit(order, { lines })

      const after = (await t.api.get(`/api/customers/${w.customerId}?asOf=2026-10-10`)).body.balance
      expect(after).toBe(46856)
    })
  })

  describe('deleting', () => {
    it('removes the order from lists and from the debt, and restore brings it back', async () => {
      const order = await createOrder()
      const debt = async () => (await t.api.get(`/api/customers/${w.customerId}?asOf=2026-10-11`)).body.balance
      expect(await debt()).toBe(71856)

      const deleted = await t.api.delete(`/api/orders/${order.id}`)
      expect(deleted.body.deletedAt).not.toBeNull()
      expect(await debt()).toBe(59356)
      expect((await t.api.get('/api/orders')).body.items).toHaveLength(0)

      const restored = await t.api.post(`/api/orders/${order.id}/restore`)
      expect(restored.body.deletedAt).toBeNull()
      expect(await debt()).toBe(71856)
    })

    it('lists deleted orders on request, most recently deleted first', async () => {
      const older = await createOrder()
      const newer = await createOrder()
      const kept = await createOrder()
      await t.api.delete(`/api/orders/${newer.id}`)
      t.setNow(new Date('2026-10-11T03:01:00Z'))
      await t.api.delete(`/api/orders/${older.id}`)

      const deletedList = (await t.api.get('/api/orders?deleted=1')).body
      expect(deletedList.items.map((order: { id: string }) => order.id)).toEqual([older.id, newer.id])
      expect(deletedList.total).toBe(2)
      expect((await t.api.get('/api/orders')).body.items.map((order: { id: string }) => order.id)).toEqual([kept.id])

      // Restoring takes it off the deleted list.
      await t.api.post(`/api/orders/${older.id}/restore`)
      expect((await t.api.get('/api/orders?deleted=1')).body.items).toHaveLength(1)
    })

    it('rejects a deleted filter other than 0 or 1', async () => {
      expect((await t.api.get('/api/orders?deleted=yes')).status).toBe(400)
    })

    it('cannot edit a deleted order', async () => {
      const order = await createOrder()
      await t.api.delete(`/api/orders/${order.id}`)

      const response = await t.api.put(`/api/orders/${order.id}`, { ...orderBody(), version: order.version })

      expect(response.status).toBe(409)
    })

    it('never reuses the code of a deleted order', async () => {
      const first = await createOrder()
      await t.api.delete(`/api/orders/${first.id}`)

      const second = await createOrder()

      expect(second.code).toBe('HĐ-0002')
    })
  })
})
