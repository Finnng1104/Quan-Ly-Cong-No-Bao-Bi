import type { TestApp } from './app.js'

export interface World {
  customerId: string
  otherCustomerId: string
  productId: string
  secondProductId: string
  unitId: string
}

/** A customer pair and a small catalog, created through the public API like a real user would. */
export async function createWorld(t: TestApp): Promise<World> {
  const customer = await t.api.post('/api/customers', {
    name: 'Thanh Nhi',
    phone: '0901234001',
    openingDebt: { amount: 59356, date: '2026-10-01' },
  })
  const other = await t.api.post('/api/customers', { name: 'Ông A', phone: '0901234002' })
  const product = await t.api.post('/api/products', { name: 'Bao kiếng' })
  const second = await t.api.post('/api/products', { name: 'Giấy A6' })
  const unit = await t.api.post('/api/units', { name: 'Cây' })

  return {
    customerId: customer.body.id as string,
    otherCustomerId: other.body.id as string,
    productId: product.body.id as string,
    secondProductId: second.body.id as string,
    unitId: unit.body.id as string,
  }
}
