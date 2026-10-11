import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../../../test/helpers/app.js'

describe('settings', () => {
  let t: TestApp

  beforeEach(async () => {
    t = await createTestApp()
  })

  afterEach(async () => {
    await t.close()
  })

  it('starts with the shop defaults', async () => {
    const response = await t.api.get('/api/settings')

    expect(response.body).toEqual({
      shopName: 'Cửa Hàng Của Tôi',
      vatRatePercent: 8,
      showDebtOnTicket: true,
    })
  })

  it('updates only what is sent', async () => {
    await t.api.patch('/api/settings', { shopName: 'Bao bì Khôi Lâm' })
    const response = await t.api.patch('/api/settings', { showDebtOnTicket: false })

    expect(response.body).toEqual({
      shopName: 'Bao bì Khôi Lâm',
      vatRatePercent: 8,
      showDebtOnTicket: false,
    })
  })

  it('accepts a VAT rate with up to 2 decimals', async () => {
    const response = await t.api.patch('/api/settings', { vatRatePercent: 5.5 })

    expect(response.body.vatRatePercent).toBe(5.5)
  })

  it.each([8.005, -1, 101])('rejects the VAT rate %s', async (vatRatePercent) => {
    const response = await t.api.patch('/api/settings', { vatRatePercent })

    expect(response.status).toBe(400)
  })

  it('rejects an empty shop name', async () => {
    expect((await t.api.patch('/api/settings', { shopName: '  ' })).status).toBe(400)
  })
})
