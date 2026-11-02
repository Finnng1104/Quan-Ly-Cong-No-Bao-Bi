import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'

interface Item {
  id: string
  name: string
}

describe('products and units', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp()
  })

  afterEach(async () => {
    await t.close()
  })

  it.each(['products', 'units'] as const)('%s: create, list in creation order, rename', async (kind) => {
    const first = (await t.api.post(`/api/${kind}`, { name: 'Bao kiếng' })).body as Item
    await t.api.post(`/api/${kind}`, { name: 'Giấy A6' })

    const renamed = await t.api.patch(`/api/${kind}/${first.id}`, { name: 'Bao kính' })
    const list = await t.api.get(`/api/${kind}`)

    expect(renamed.body).toEqual({ id: first.id, name: 'Bao kính' })
    expect(list.body.items.map((item: Item) => item.name)).toEqual(['Bao kính', 'Giấy A6'])
  })

  it.each(['products', 'units'] as const)('%s: reject an empty name', async (kind) => {
    const response = await t.api.post(`/api/${kind}`, { name: '  ' })

    expect(response.status).toBe(400)
  })

  it.each(['products', 'units'] as const)('%s: delete is soft and hides the item', async (kind) => {
    const item = (await t.api.post(`/api/${kind}`, { name: 'Dây thun' })).body as Item

    expect((await t.api.delete(`/api/${kind}/${item.id}`)).status).toBe(200)

    expect((await t.api.get(`/api/${kind}`)).body.items).toHaveLength(0)
    // The row is still there, so documents that reference it keep working.
    const row = t.db.prepare(`SELECT deleted_at FROM ${kind} WHERE id = ?`).get(item.id) as {
      deleted_at: string | null
    }
    expect(row.deleted_at).not.toBeNull()
    expect((await t.api.patch(`/api/${kind}/${item.id}`, { name: 'Again' })).status).toBe(404)
  })
})

describe('price book', () => {
  let t: TestApp
  let customerId: string
  let otherCustomerId: string
  let productId: string
  let secondProductId: string
  let unitId: string

  beforeEach(async () => {
    t = await createTestApp()
    customerId = (await t.api.post('/api/customers', { name: 'Thanh Nhi' })).body.id
    otherCustomerId = (await t.api.post('/api/customers', { name: 'Ông A' })).body.id
    productId = (await t.api.post('/api/products', { name: 'Bao kiếng' })).body.id
    secondProductId = (await t.api.post('/api/products', { name: 'Giấy A6' })).body.id
    unitId = (await t.api.post('/api/units', { name: 'Cây' })).body.id
  })

  afterEach(async () => {
    await t.close()
  })

  const setPrice = (customer: string, product: string, price: number) =>
    t.api.put(`/api/customers/${customer}/prices`, { productId: product, unitId, price })

  it('sets a price and updates the same entry instead of adding a second one', async () => {
    const first = await setPrice(customerId, productId, 500)
    const second = await setPrice(customerId, productId, 600)

    expect(second.body.id).toBe(first.body.id)
    const list = await t.api.get(`/api/customers/${customerId}/prices`)
    expect(list.body.items).toEqual([{ id: first.body.id, productId, unitId, price: 600 }])
  })

  it('keeps prices per customer', async () => {
    await setPrice(customerId, productId, 500)
    await setPrice(otherCustomerId, productId, 550)

    const mine = await t.api.get(`/api/customers/${customerId}/prices`)
    const theirs = await t.api.get(`/api/customers/${otherCustomerId}/prices`)

    expect(mine.body.items[0].price).toBe(500)
    expect(theirs.body.items[0].price).toBe(550)
  })

  it('validates product, unit and price', async () => {
    const unknownProduct = await setPrice(customerId, 'nope', 500)
    const negative = await setPrice(customerId, productId, -1)
    const tooPrecise = await setPrice(customerId, productId, 10.0005)

    expect(unknownProduct.status).toBe(400)
    expect(negative.status).toBe(400)
    expect(tooPrecise.status).toBe(400)
    expect((await t.api.put('/api/customers/nope/prices', { productId, unitId, price: 1 })).status).toBe(404)
  })

  it('hides prices of deleted products', async () => {
    await setPrice(customerId, productId, 500)
    await setPrice(customerId, secondProductId, 700)

    await t.api.delete(`/api/products/${productId}`)

    const list = await t.api.get(`/api/customers/${customerId}/prices`)
    expect(list.body.items.map((entry: { productId: string }) => entry.productId)).toEqual([secondProductId])
  })

  it('removes an entry', async () => {
    const entry = (await setPrice(customerId, productId, 500)).body

    expect((await t.api.delete(`/api/prices/${entry.id}`)).status).toBe(200)

    expect((await t.api.get(`/api/customers/${customerId}/prices`)).body.items).toHaveLength(0)
    expect((await t.api.delete(`/api/prices/${entry.id}`)).status).toBe(404)
  })

  it('copies another customer’s list and replaces the target’s own', async () => {
    await setPrice(customerId, productId, 500)
    await setPrice(customerId, secondProductId, 550)
    await setPrice(otherCustomerId, productId, 999) // will be replaced

    const copied = await t.api.post(`/api/customers/${otherCustomerId}/prices/copy-from/${customerId}`)

    expect(copied.status).toBe(200)
    const prices = copied.body.items.map((entry: { productId: string; price: number }) => [entry.productId, entry.price])
    expect(prices).toEqual([
      [productId, 500],
      [secondProductId, 550],
    ])
    // The source is untouched and the copied entries have their own ids.
    const source = await t.api.get(`/api/customers/${customerId}/prices`)
    expect(source.body.items).toHaveLength(2)
    expect(new Set([...source.body.items, ...copied.body.items].map((e: { id: string }) => e.id)).size).toBe(4)
  })

  it('does nothing when copying a customer onto itself', async () => {
    await setPrice(customerId, productId, 500)

    const response = await t.api.post(`/api/customers/${customerId}/prices/copy-from/${customerId}`)

    expect(response.body.items).toHaveLength(1)
  })
})
