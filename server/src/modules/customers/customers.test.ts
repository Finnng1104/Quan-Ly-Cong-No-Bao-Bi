import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'

describe('customers', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp() // clock: 2026-10-11 03:00 UTC = 10:00 in Ho Chi Minh
  })

  afterEach(async () => {
    await t.close()
  })

  const create = async (body: Record<string, unknown>) => {
    const response = await t.api.post('/api/customers', body)
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body as { id: string; name: string; openingDebt: { amount: number; date: string } }
  }

  describe('create and update', () => {
    it('needs only a name; the opening debt starts at 0 today (shop time)', async () => {
      const customer = await create({ name: 'Thanh Nhi' })

      expect(customer).toMatchObject({
        name: 'Thanh Nhi',
        phone: '',
        address: '',
        note: '',
        openingDebt: { amount: 0, date: '2026-10-11' },
      })
    })

    it('keeps an opening debt with its date', async () => {
      const customer = await create({
        name: 'Ông A',
        phone: '0901234002',
        openingDebt: { amount: 120000, date: '2026-09-01' },
      })

      expect(customer.openingDebt).toEqual({ amount: 120000, date: '2026-09-01' })
    })

    it('rejects a missing name and a bad date with field messages', async () => {
      const noName = await t.api.post('/api/customers', { name: '   ' })
      const badDate = await t.api.post('/api/customers', {
        name: 'X',
        openingDebt: { amount: 1, date: '2026-02-30' },
      })

      expect(noName.status).toBe(400)
      expect(noName.body).toMatchObject({ error: { fields: { name: expect.any(String) } } })
      expect(badDate.status).toBe(400)
      expect(badDate.body).toMatchObject({ error: { fields: { 'openingDebt.date': expect.any(String) } } })
    })

    it('rejects a fractional opening debt (money is whole VND)', async () => {
      const response = await t.api.post('/api/customers', {
        name: 'X',
        openingDebt: { amount: 10.5 },
      })

      expect(response.status).toBe(400)
    })

    it('updates only the fields that are sent', async () => {
      const customer = await create({ name: 'Chị Hoa', phone: '0903', note: 'quen' })

      const response = await t.api.patch(`/api/customers/${customer.id}`, { phone: '0909' })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ name: 'Chị Hoa', phone: '0909', note: 'quen' })
    })

    it('returns 404 for an unknown customer', async () => {
      expect((await t.api.get('/api/customers/nope')).status).toBe(404)
      expect((await t.api.patch('/api/customers/nope', { name: 'x' })).status).toBe(404)
    })

    it('does not expose customers of another branch', async () => {
      t.db
        .prepare("INSERT INTO branches (id, name, is_default, created_at) VALUES ('b2', 'Other', 0, 'x')")
        .run()
      t.db
        .prepare(
          `INSERT INTO customers (id, branch_id, name, search_text, opening_debt_date, created_at, updated_at)
           VALUES ('other-1', 'b2', 'Hidden', 'hidden', '2026-01-01', 'x', 'x')`,
        )
        .run()

      expect((await t.api.get('/api/customers/other-1')).status).toBe(404)
      const list = await t.api.get('/api/customers')
      expect(list.body.items).toHaveLength(0)
    })
  })

  describe('listing', () => {
    beforeEach(async () => {
      await create({ name: 'Thanh Nhi', phone: '0901234001', openingDebt: { amount: 59356, date: '2026-09-11' } })
      await create({ name: 'Ông A (Nguyễn Văn An)', phone: '0901234002', openingDebt: { amount: 120000, date: '2026-09-11' } })
      await create({ name: 'Chị Phượng', phone: '0901234008', openingDebt: { amount: 34000, date: '2026-09-11' } })
      await create({ name: 'Anh Khoa', phone: '0901234009' })
    })

    it('sorts by debt, largest first, then by name', async () => {
      const response = await t.api.get('/api/customers')

      expect(response.body.items.map((c: { name: string }) => c.name)).toEqual([
        'Ông A (Nguyễn Văn An)',
        'Thanh Nhi',
        'Chị Phượng',
        'Anh Khoa',
      ])
      expect(response.body.total).toBe(4)
    })

    it('can sort ascending', async () => {
      const response = await t.api.get('/api/customers?sort=debt_asc')

      expect(response.body.items[0].name).toBe('Anh Khoa')
    })

    it('finds customers by name or phone, with or without diacritics', async () => {
      const byAccentless = await t.api.get('/api/customers?q=phuong')
      const byAccent = await t.api.get('/api/customers?q=Phượng')
      const byPhone = await t.api.get('/api/customers?q=0901234002')
      const byOtherName = await t.api.get('/api/customers?q=nguyen%20van')

      expect(byAccentless.body.items.map((c: { name: string }) => c.name)).toEqual(['Chị Phượng'])
      expect(byAccent.body.items).toHaveLength(1)
      expect(byPhone.body.items.map((c: { name: string }) => c.name)).toEqual(['Ông A (Nguyễn Văn An)'])
      expect(byOtherName.body.items).toHaveLength(1)
    })

    it('treats % and _ in the search as plain characters', async () => {
      expect((await t.api.get('/api/customers?q=%25')).body.items).toHaveLength(0)
      expect((await t.api.get('/api/customers?q=_')).body.items).toHaveLength(0)
    })

    it('shows the debt on the chosen date: nothing before the opening date', async () => {
      const before = await t.api.get('/api/customers?asOf=2026-09-01')
      const after = await t.api.get('/api/customers?asOf=2026-10-11')

      expect(before.body.summary.totalDebt).toBe(0)
      expect(after.body.summary.totalDebt).toBe(59356 + 120000 + 34000)
    })

    it('pages the results, while the summary still covers every match', async () => {
      const page = await t.api.get('/api/customers?limit=2&offset=2')

      expect(page.body.items.map((c: { name: string }) => c.name)).toEqual(['Chị Phượng', 'Anh Khoa'])
      expect(page.body.total).toBe(4)
      expect(page.body.summary.totalDebt).toBe(213356)
    })

    it('rejects an invalid page size', async () => {
      expect((await t.api.get('/api/customers?limit=0')).status).toBe(400)
      expect((await t.api.get('/api/customers?limit=500')).status).toBe(400)
    })

    it('counts each customer’s price entries, ignoring deleted products', async () => {
      const [first] = (await t.api.get('/api/customers?q=nhi')).body.items
      const product = (await t.api.post('/api/products', { name: 'Bao kiếng' })).body
      const gone = (await t.api.post('/api/products', { name: 'Đã xóa' })).body
      const unit = (await t.api.post('/api/units', { name: 'Cây' })).body
      await t.api.put(`/api/customers/${first.id}/prices`, { productId: product.id, unitId: unit.id, price: 500 })
      await t.api.put(`/api/customers/${first.id}/prices`, { productId: gone.id, unitId: unit.id, price: 700 })
      await t.api.delete(`/api/products/${gone.id}`)

      const list = (await t.api.get('/api/customers')).body.items as { id: string; priceCount: number }[]

      expect(list.find((c) => c.id === first.id)?.priceCount).toBe(1)
      expect(list.filter((c) => c.id !== first.id).every((c) => c.priceCount === 0)).toBe(true)
    })

    it('updates search when the name or phone changes', async () => {
      const [first] = (await t.api.get('/api/customers?q=nhi')).body.items

      await t.api.patch(`/api/customers/${first.id}`, { name: 'Thanh Mai' })

      expect((await t.api.get('/api/customers?q=nhi')).body.items).toHaveLength(0)
      expect((await t.api.get('/api/customers?q=mai')).body.items).toHaveLength(1)
    })
  })

  describe('detail', () => {
    it('returns the debt as of a date', async () => {
      const customer = await create({
        name: 'Cô Lan',
        openingDebt: { amount: 210500, date: '2026-09-11' },
      })

      const early = await t.api.get(`/api/customers/${customer.id}?asOf=2026-09-10`)
      const late = await t.api.get(`/api/customers/${customer.id}?asOf=2026-09-11`)

      expect(early.body.balance).toBe(0)
      expect(late.body.balance).toBe(210500)
    })
  })

  describe('delete', () => {
    it('hides a customer with transactions from the list, the detail and the debt total', async () => {
      const keep = await create({ name: 'Cô Lan', openingDebt: { amount: 1000, date: '2026-09-01' } })
      const gone = await create({ name: 'Thanh Hoa Jeans', openingDebt: { amount: 6485, date: '2026-09-01' } })
      const payment = await t.api.post('/api/payments', {
        customerId: gone.id,
        date: '2026-09-02',
        amount: 485,
      })
      expect(payment.status, JSON.stringify(payment.body)).toBe(201)

      const response = await t.api.delete(`/api/customers/${gone.id}`)

      expect(response.status).toBe(204)
      const list = await t.api.get('/api/customers')
      expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([keep.id])
      expect(list.body.summary.totalDebt).toBe(1000)
      expect((await t.api.get(`/api/customers/${gone.id}`)).status).toBe(404)
      expect((await t.api.get('/api/customers?q=hoa')).body.items).toHaveLength(0)
    })

    it('rejects new transactions for a deleted customer', async () => {
      const customer = await create({ name: 'Ông A' })
      await t.api.delete(`/api/customers/${customer.id}`)

      const payment = await t.api.post('/api/payments', { customerId: customer.id, date: '2026-10-11', amount: 1 })

      expect(payment.status).toBe(404)
    })

    it('returns 404 for an unknown or already deleted customer', async () => {
      const customer = await create({ name: 'Ông B' })
      await t.api.delete(`/api/customers/${customer.id}`)

      expect((await t.api.delete(`/api/customers/${customer.id}`)).status).toBe(404)
      expect((await t.api.delete('/api/customers/missing')).status).toBe(404)
    })
  })
})
