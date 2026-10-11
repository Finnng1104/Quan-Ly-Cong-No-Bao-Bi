import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'
import { createWorld, type World } from '../../../test/helpers/world.js'

describe('returns, payments and adjustments', () => {
  let t: TestApp
  let w: World

  beforeEach(async () => {
    t = await createTestApp()
    w = await createWorld(t)
  })

  afterEach(async () => {
    await t.close()
  })

  const debtOn = async (asOf: string): Promise<number> =>
    (await t.api.get(`/api/customers/${w.customerId}?asOf=${asOf}`)).body.balance as number

  describe('payments', () => {
    it('are numbered TT- and reduce the shared debt on their date', async () => {
      const response = await t.api.post('/api/payments', {
        customerId: w.customerId,
        date: '2026-10-09',
        amount: 30000,
        note: 'Trả bớt',
      })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ code: 'TT-0001', amount: 30000, note: 'Trả bớt', deletedAt: null })
      expect(await debtOn('2026-10-08')).toBe(59356)
      expect(await debtOn('2026-10-09')).toBe(59356 - 30000)
    })

    it('reject a zero or fractional amount, a bad date and an unknown customer', async () => {
      const base = { customerId: w.customerId, date: '2026-10-09', amount: 1000 }

      expect((await t.api.post('/api/payments', { ...base, amount: 0 })).status).toBe(400)
      expect((await t.api.post('/api/payments', { ...base, amount: -5 })).status).toBe(400)
      expect((await t.api.post('/api/payments', { ...base, amount: 10.5 })).status).toBe(400)
      expect((await t.api.post('/api/payments', { ...base, date: 'tomorrow' })).status).toBe(400)
      expect((await t.api.post('/api/payments', { ...base, customerId: 'nope' })).status).toBe(404)
    })

    it('may exceed the debt: the balance simply goes negative', async () => {
      await t.api.post('/api/payments', { customerId: w.customerId, date: '2026-10-09', amount: 100000 })

      expect(await debtOn('2026-10-09')).toBe(59356 - 100000)
    })

    it('are listed newest first, can be filtered by customer, and soft deleted', async () => {
      const first = await t.api.post('/api/payments', { customerId: w.customerId, date: '2026-10-08', amount: 1000 })
      await t.api.post('/api/payments', { customerId: w.otherCustomerId, date: '2026-10-09', amount: 2000 })

      const all = await t.api.get('/api/payments')
      expect(all.body.items.map((p: { amount: number }) => p.amount)).toEqual([2000, 1000])

      const mine = await t.api.get(`/api/payments?customerId=${w.customerId}`)
      expect(mine.body.total).toBe(1)

      await t.api.delete(`/api/payments/${first.body.id}`)
      expect((await t.api.get('/api/payments')).body.total).toBe(1)
      expect(await debtOn('2026-10-11')).toBe(59356) // the payment no longer counts
      expect((await t.api.delete('/api/payments/nope')).status).toBe(404)
    })
  })

  describe('returns', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      customerId: w.customerId,
      date: '2026-10-09',
      lines: [{ productId: w.productId, unitId: w.unitId, qty: 5, price: 600 }],
      reason: 'Bao rách',
      ...over,
    })

    it('are numbered TH-, computed by the server, and reduce the debt', async () => {
      const response = await t.api.post('/api/returns', {
        ...body(),
        total: 1,
        lines: [{ productId: w.productId, unitId: w.unitId, qty: 5, price: 600, amount: 1 }],
      })

      expect(response.status).toBe(201)
      expect(response.body).toMatchObject({ code: 'TH-0001', total: 3000, reason: 'Bao rách' })
      expect(response.body.lines[0]).toMatchObject({ qty: 5, price: 600, amount: 3000 })
      expect(await debtOn('2026-10-09')).toBe(59356 - 3000)
    })

    it('need a line, a valid product and a sane quantity', async () => {
      expect((await t.api.post('/api/returns', body({ lines: [] }))).status).toBe(400)
      expect(
        (await t.api.post('/api/returns', body({ lines: [{ productId: 'nope', unitId: w.unitId, qty: 1, price: 1 }] })))
          .status,
      ).toBe(400)
      expect(
        (await t.api.post('/api/returns', body({ lines: [{ productId: w.productId, unitId: w.unitId, qty: 0, price: 1 }] })))
          .status,
      ).toBe(400)
    })

    it('are listed and soft deleted', async () => {
      const created = await t.api.post('/api/returns', body())

      expect((await t.api.get('/api/returns')).body.total).toBe(1)
      await t.api.delete(`/api/returns/${created.body.id}`)

      expect((await t.api.get('/api/returns')).body.total).toBe(0)
      expect(await debtOn('2026-10-11')).toBe(59356)
      expect((await t.api.delete('/api/returns/nope')).status).toBe(404)
    })
  })

  describe('adjustments', () => {
    it('add to the debt when positive and reduce it when negative', async () => {
      const ship = await t.api.post('/api/adjustments', {
        customerId: w.customerId,
        date: '2026-10-09',
        amount: 30000,
        note: 'Tiền ship',
      })
      await t.api.post('/api/adjustments', {
        customerId: w.customerId,
        date: '2026-10-09',
        amount: -5000,
        note: 'Bớt nợ',
      })

      expect(ship.status).toBe(201)
      expect(ship.body.code).toBe('PS-0001')
      expect(await debtOn('2026-10-08')).toBe(59356)
      expect(await debtOn('2026-10-09')).toBe(59356 + 30000 - 5000)
    })

    it('reject a zero amount', async () => {
      const response = await t.api.post('/api/adjustments', {
        customerId: w.customerId,
        date: '2026-10-09',
        amount: 0,
      })

      expect(response.status).toBe(400)
    })

    it('are listed per customer and soft deleted', async () => {
      const created = await t.api.post('/api/adjustments', {
        customerId: w.customerId,
        date: '2026-10-09',
        amount: 1000,
      })
      await t.api.post('/api/adjustments', { customerId: w.otherCustomerId, date: '2026-10-09', amount: 2000 })

      const mine = await t.api.get(`/api/adjustments?customerId=${w.customerId}`)
      expect(mine.body.items.map((a: { amount: number }) => a.amount)).toEqual([1000])

      await t.api.delete(`/api/adjustments/${created.body.id}`)
      expect((await t.api.get(`/api/adjustments?customerId=${w.customerId}`)).body.total).toBe(0)
    })
  })

  it('share one sequence, so documents of a day keep the order they were created in', async () => {
    const payment = await t.api.post('/api/payments', { customerId: w.customerId, date: '2026-10-09', amount: 1 })
    const adjustment = await t.api.post('/api/adjustments', {
      customerId: w.customerId,
      date: '2026-10-09',
      amount: 1,
    })
    const goodsReturn = await t.api.post('/api/returns', {
      customerId: w.customerId,
      date: '2026-10-09',
      lines: [{ productId: w.productId, unitId: w.unitId, qty: 1, price: 1 }],
    })

    expect([payment.body.seq, adjustment.body.seq, goodsReturn.body.seq]).toEqual([1, 2, 3])
  })
})
