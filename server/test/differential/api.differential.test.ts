// End-to-end differential test: the SQL read models behind the HTTP API must give the same
// numbers as the pure ledger functions (which are themselves checked against the web app's
// debt.js). Random datasets are written straight into the tables, then read back over HTTP.

import { afterEach, describe, expect, it } from 'vitest'
import * as ledger from '../../src/modules/ledger/index.js'
import { addDays, monthStart } from '../../src/shared/dates.js'
import { createTestApp, type TestApp } from '../helpers/app.js'
import { loadDataset } from '../helpers/load-dataset.js'
import { BASE_DATE, DAY_SPAN, generateDataset, probeDates } from './generate.js'

const SEEDS = Array.from({ length: 40 }, (_, index) => 5_000 + index)

describe('HTTP read models vs the pure ledger', () => {
  let t: TestApp | null = null

  afterEach(async () => {
    await t?.close()
    t = null
  })

  it.each(SEEDS)('seed %i', async (seed) => {
    const data = generateDataset(seed)
    t = await createTestApp()
    loadDataset(t.db, data, { productIds: data.productIds, unitIds: data.unitIds })
    const { api } = t

    // ----- customer list: balance, day activity, summary -----
    for (const asOf of probeDates()) {
      const list = (await api.get(`/api/customers?asOf=${asOf}&limit=200`)).body
      const debts = ledger.debtsByCustomer(data, asOf)
      const activity = ledger.dayActivitiesByCustomer(data, asOf)

      for (const item of list.items as { id: string; balance: number; act: { up: number; down: number } }[]) {
        expect(item.balance, `balance ${item.id} @${asOf}`).toBe(debts[item.id])
        expect(item.act, `act ${item.id} @${asOf}`).toEqual(activity[item.id] ?? { up: 0, down: 0 })
      }
      expect(list.summary.totalDebt).toBe(ledger.totalDebtAt(data, asOf))
      expect(list.total).toBe(data.customers.length)
    }

    for (const customer of data.customers) {
      // ----- ledger tab (newest first, running balance) -----
      for (const until of [addDays(BASE_DATE, 15), addDays(BASE_DATE, DAY_SPAN + 30)]) {
        const page = (await api.get(`/api/customers/${customer.id}/ledger?until=${until}&limit=200`)).body
        const expected = ledger.fullLedger(customer.id, data, until).reverse()

        expect(page.total).toBe(expected.length)
        expect(page.balance).toBe(ledger.balanceAt(customer.id, data, until))
        expect(
          page.items.map((r: Record<string, unknown>) => ({
            date: r.date,
            seq: r.seq,
            kind: r.kind,
            desc: r.desc,
            refId: r.refId,
            up: r.up,
            down: r.down,
            balance: r.balance,
          })),
        ).toEqual(
          expected.map((r) => ({
            date: r.date,
            seq: r.seq,
            kind: r.kind,
            desc: r.desc,
            refId: r.refId,
            up: r.up,
            down: r.down,
            balance: r.balance,
          })),
        )
      }

      // ----- statement for a range -----
      const from = addDays(BASE_DATE, 5)
      const to = addDays(BASE_DATE, 25)
      const statement = (await api.get(`/api/customers/${customer.id}/statement?from=${from}&to=${to}`)).body
      const expectedRange = ledger.ledgerRows(customer.id, data, from, to)

      expect(statement.opening).toBe(expectedRange.opening)
      expect(statement.closing).toBe(expectedRange.closing)
      expect(statement.rows.map((r: { balance: number; up: number; down: number; date: string }) => [r.date, r.up, r.down, r.balance])).toEqual(
        expectedRange.rows.map((r) => [r.date, r.up, r.down, r.balance]),
      )
      expect(statement.purchaseTotals.range).toEqual(ledger.purchaseTotal(customer.id, data, from, to))

      // ----- purchased / returned -----
      const purchased = (await api.get(`/api/customers/${customer.id}/purchased-returned`)).body
      const expectedPurchased = ledger.purchasedReturned(customer.id, data)
      const actual = new Map<string, { bought: number; returned: number }>(
        (purchased.items as { productId: string; unitId: string; bought: number; returned: number }[]).map((i) => [
          `${i.productId}|${i.unitId}`,
          { bought: i.bought, returned: i.returned },
        ]),
      )
      expect([...actual.keys()].sort()).toEqual([...expectedPurchased.keys()].sort())
      for (const [key, value] of expectedPurchased) {
        expect(actual.get(key)).toEqual(value)
      }
    }

    // ----- debt before / after each order -----
    for (const order of data.orders) {
      const detail = (await api.get(`/api/orders/${order.id}`)).body
      const before = ledger.balanceBeforeOrder(order.customerId, data, order)
      expect(detail.balanceBefore, `before ${order.id}`).toBe(before)
      expect(detail.balanceAfter).toBe(before + order.total)
    }

    // ----- dashboard -----
    for (const date of probeDates()) {
      const board = (await api.get(`/api/dashboard?date=${date}`)).body
      const debts = ledger.debtsByCustomer(data, date)
      const debtors = data.customers
        .map((c) => ({ ...c, debt: debts[c.id] ?? 0 }))
        .filter((c) => c.debt > 0)
        .sort((a, b) => b.debt - a.debt)

      expect(board.totalDebt).toBe(ledger.totalDebtAt(data, date))
      expect(board.debtorCount).toBe(debtors.length)
      expect(board.day).toEqual(ledger.dailyTotals(data, date))
      expect(board.month).toEqual(ledger.rangeTotals(data, monthStart(date), date))
      expect(board.series).toEqual(ledger.debtSeries(data, date, 14))
      expect(board.topDebtors.map((d: { customerId: string; balance: number }) => [d.customerId, d.balance])).toEqual(
        debtors.slice(0, 5).map((d) => [d.id, d.debt]),
      )
    }

    // ----- exported debt list -----
    for (const asOf of probeDates()) {
      const report = (await api.get(`/api/reports/customer-debts?asOf=${asOf}`)).body
      const expected = ledger.customerDebtRows(data, asOf)

      expect(
        report.items.map((r: Record<string, unknown> & { customer: { id: string } }) => [
          r.customer.id,
          r.opening,
          r.orders,
          r.returns,
          r.payments,
          r.adjust,
          r.end,
        ]),
      ).toEqual(
        expected.map((r) => [r.customer.id, r.opening, r.orders, r.returns, r.payments, r.adjust, r.end]),
      )
    }
  })
})

describe('statement exports and "edited since" tracking', () => {
  let t: TestApp

  afterEach(async () => {
    await t.close()
  })

  it('flags orders edited after the latest export of the same customer, with the total difference', async () => {
    t = await createTestApp()
    const customer = (await t.api.post('/api/customers', { name: 'Chị Hoa' })).body
    const product = (await t.api.post('/api/products', { name: 'Bao kiếng' })).body
    const unit = (await t.api.post('/api/units', { name: 'Cây' })).body
    const order = (
      await t.api.post('/api/orders', {
        customerId: customer.id,
        date: '2026-10-08',
        lines: [{ productId: product.id, unitId: unit.id, qty: 30, price: 550 }],
      })
    ).body

    // Nothing exported yet, so nothing can be "edited after the last export".
    const first = (await t.api.get(`/api/customers/${customer.id}/statement?from=2026-10-01&to=2026-10-31`)).body
    expect(first.lastExport).toBeNull()
    expect(first.editedOrders).toEqual([])

    t.setNow(new Date('2026-10-12T03:00:00Z'))
    const exported = await t.api.post(`/api/customers/${customer.id}/statement-exports`, {
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(exported.status).toBe(201)

    t.setNow(new Date('2026-10-13T03:00:00Z'))
    await t.api.put(`/api/orders/${order.id}`, {
      customerId: customer.id,
      date: '2026-10-08',
      lines: [{ id: order.lines[0].id, productId: product.id, unitId: unit.id, qty: 40, price: 550 }],
      version: order.version,
    })

    const after = (await t.api.get(`/api/customers/${customer.id}/statement?from=2026-10-01&to=2026-10-31`)).body
    expect(after.lastExport).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(after.editedOrders).toHaveLength(1)
    expect(after.editedOrders[0]).toMatchObject({
      id: order.id,
      code: 'HĐ-0001',
      latestEditSinceExport: { oldTotal: 16500, newTotal: 22000, diff: 5500 },
    })
    expect(after.totalDiff).toBe(5500)
    expect(after.rows.find((r: { refId: string }) => r.refId === order.id).edited).toBe(true)
  })

  it('does not treat another customer’s export as a marker', async () => {
    t = await createTestApp()
    const a = (await t.api.post('/api/customers', { name: 'A' })).body
    const b = (await t.api.post('/api/customers', { name: 'B' })).body
    await t.api.post(`/api/customers/${a.id}/statement-exports`, { from: '2026-10-01', to: '2026-10-31' })

    const statement = (await t.api.get(`/api/customers/${b.id}/statement?from=2026-10-01&to=2026-10-31`)).body

    expect(statement.lastExport).toBeNull()
  })

  it('validates the range', async () => {
    t = await createTestApp()
    const customer = (await t.api.post('/api/customers', { name: 'A' })).body

    expect((await t.api.get(`/api/customers/${customer.id}/statement?from=2026-10-31&to=2026-10-01`)).status).toBe(400)
    expect((await t.api.get(`/api/customers/${customer.id}/statement?from=2026-10-01`)).status).toBe(400)
    expect(
      (await t.api.post(`/api/customers/${customer.id}/statement-exports`, { from: '2026-10-31', to: '2026-10-01' })).status,
    ).toBe(400)
    expect((await t.api.get('/api/customers/nope/statement?from=2026-10-01&to=2026-10-31')).status).toBe(404)
  })

  it('counts the last 12 months from the same day a year earlier', async () => {
    t = await createTestApp()
    const customer = (await t.api.post('/api/customers', { name: 'A' })).body
    const product = (await t.api.post('/api/products', { name: 'P' })).body
    const unit = (await t.api.post('/api/units', { name: 'U' })).body
    const order = (date: string) =>
      t.api.post('/api/orders', {
        customerId: customer.id,
        date,
        lines: [{ productId: product.id, unitId: unit.id, qty: 1, price: 1000 }],
      })
    await order('2025-10-10') // one day before the window opens
    await order('2025-10-11') // first day of the window
    await order('2026-10-11')

    const statement = (await t.api.get(`/api/customers/${customer.id}/statement?from=2026-10-01&to=2026-10-11`)).body

    expect(statement.purchaseTotals.last12Months).toEqual({ total: 2000, count: 2 })
    expect(statement.purchaseTotals.range).toEqual({ total: 1000, count: 1 })
  })
})
