// Every call to the backend, grouped by area. Pages never build URLs themselves.
// Responses are adapted to the record shapes the screens already use (for example `vat.rate`).

import { request } from './client'

const PAGE_SIZE = 200

// ----- adapters: server shape -> shape used by the screens -----

function toOrder(dto) {
  return {
    ...dto,
    vat: dto.vat ? { rate: dto.vat.ratePercent, amount: dto.vat.amount, manual: dto.vat.manual } : null,
  }
}

function toSettings(dto) {
  return {
    shopName: dto.shopName,
    vatRate: dto.vatRatePercent,
    showDebtOnTicket: dto.showDebtOnTicket,
  }
}

function toCustomerListItem(item) {
  return { ...item, debt: item.balance }
}

export const api = {
  auth: {
    me: () => request('GET', '/auth/me'),
    login: (username, password) => request('POST', '/auth/login', { body: { username, password } }),
    logout: () => request('POST', '/auth/logout'),
    changePassword: (oldPassword, newPassword) =>
      request('POST', '/auth/change-password', { body: { oldPassword, newPassword } }),
  },

  settings: {
    get: async () => toSettings(await request('GET', '/settings')),
    update: async (patch) => toSettings(await request('PATCH', '/settings', { body: patch })),
  },

  customers: {
    /** One page: { items, total, summary }. Items carry `debt`, `act` (that day's activity), `priceCount`. */
    list: async ({ q, sort, asOf, limit, offset = 0 } = {}) => {
      // The server rejects a page larger than PAGE_SIZE, but "Xem thêm" keeps growing `limit`,
      // so a long list is fetched as several consecutive pages and stitched together.
      const items = []
      let page
      do {
        page = await request('GET', '/customers', {
          query: { q, sort, asOf, limit: Math.min(PAGE_SIZE, limit - items.length), offset: offset + items.length },
        })
        items.push(...page.items)
        // An empty page means the list ended early (e.g. rows deleted meanwhile).
      } while (items.length < limit && items.length < page.total - offset && page.items.length > 0)
      return { ...page, items: items.map(toCustomerListItem) }
    },
    /** Every customer, fetched page by page. Used by pickers, which filter locally. */
    listAll: async ({ asOf } = {}) => {
      const items = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await request('GET', '/customers', { query: { asOf, limit: PAGE_SIZE, offset } })
        items.push(...page.items.map(toCustomerListItem))
        if (items.length >= page.total || page.items.length === 0) return items
      }
    },
    get: (id, asOf) => request('GET', `/customers/${id}`, { query: { asOf } }),
    create: (payload) => request('POST', '/customers', { body: payload }),
    update: (id, payload) => request('PATCH', `/customers/${id}`, { body: payload }),
    remove: (id) => request('DELETE', `/customers/${id}`),
    ledger: (id, { until, limit, offset } = {}) =>
      request('GET', `/customers/${id}/ledger`, { query: { until, limit, offset } }),
    statement: (id, { from, to }) => request('GET', `/customers/${id}/statement`, { query: { from, to } }),
    recordStatementExport: (id, { from, to }) =>
      request('POST', `/customers/${id}/statement-exports`, { body: { from, to } }),
    purchasedReturned: async (id) => (await request('GET', `/customers/${id}/purchased-returned`)).items,
    prices: async (id) => (await request('GET', `/customers/${id}/prices`)).items,
    setPrice: (id, { productId, unitId, price }) =>
      request('PUT', `/customers/${id}/prices`, { body: { productId, unitId, price } }),
    copyPrices: async (toId, fromId) =>
      (await request('POST', `/customers/${toId}/prices/copy-from/${fromId}`)).items,
  },

  prices: {
    remove: (id) => request('DELETE', `/prices/${id}`),
  },

  products: {
    list: async () => (await request('GET', '/products')).items,
    create: (name) => request('POST', '/products', { body: { name } }),
    rename: (id, name) => request('PATCH', `/products/${id}`, { body: { name } }),
    remove: (id) => request('DELETE', `/products/${id}`),
  },

  units: {
    list: async () => (await request('GET', '/units')).items,
    create: (name) => request('POST', '/units', { body: { name } }),
    rename: (id, name) => request('PATCH', `/units/${id}`, { body: { name } }),
    remove: (id) => request('DELETE', `/units/${id}`),
  },

  orders: {
    /**
     * { items, total, summary: { filteredTotal, dayTotal } }; items have `editCount`.
     * `deleted: true` lists only deleted orders, most recently deleted first.
     */
    list: async ({ date, customerId, deleted, limit, offset } = {}) => {
      const query = { date, customerId, deleted: deleted ? 1 : undefined, limit, offset }
      const result = await request('GET', '/orders', { query })
      return { ...result, items: result.items.map(toOrder) }
    },
    /** The order plus `balanceBefore`, `balanceAfter` and `editHistory`. */
    get: async (id) => toOrder(await request('GET', `/orders/${id}`)),
    create: async (payload) => toOrder(await request('POST', '/orders', { body: payload })),
    update: async (id, payload) => toOrder(await request('PUT', `/orders/${id}`, { body: payload })),
    remove: async (id) => toOrder(await request('DELETE', `/orders/${id}`)),
    restore: async (id) => toOrder(await request('POST', `/orders/${id}/restore`)),
  },

  returns: {
    list: ({ customerId, limit, offset } = {}) =>
      request('GET', '/returns', { query: { customerId, limit, offset } }),
    create: (payload) => request('POST', '/returns', { body: payload }),
    update: (id, payload) => request('PUT', `/returns/${id}`, { body: payload }),
    remove: (id) => request('DELETE', `/returns/${id}`),
  },

  payments: {
    list: ({ customerId, limit, offset } = {}) =>
      request('GET', '/payments', { query: { customerId, limit, offset } }),
    create: (payload) => request('POST', '/payments', { body: payload }),
    update: (id, payload) => request('PUT', `/payments/${id}`, { body: payload }),
    remove: (id) => request('DELETE', `/payments/${id}`),
  },

  adjustments: {
    create: (payload) => request('POST', '/adjustments', { body: payload }),
    remove: (id) => request('DELETE', `/adjustments/${id}`),
  },

  reports: {
    dashboard: (date) => request('GET', '/dashboard', { query: { date } }),
    customerDebts: async (asOf) => (await request('GET', '/reports/customer-debts', { query: { asOf } })).items,
  },

  backups: {
    /** { cloud: { configured, reachable }, lastBackupAt, lastCloudBackupAt, items: [{ fileName, createdAt, trigger, sizeBytes, onDevice, online }] } */
    list: () => request('GET', '/backups'),
    /** { fileName, sizeBytes, uploaded, copiedToDrive }: each true | false | null (null = not set up). */
    create: () => request('POST', '/backups'),
    /** Drives that can be chosen right now: [{ name, freeBytes }]. */
    drives: async () => (await request('GET', '/backups/drives')).drives,
    /** Chooses (or re-configures) the external drive. `volume` may be omitted to only change `mode`. */
    setDrive: ({ volume, mode }) => request('PUT', '/backups/drive', { body: { volume, mode } }),
    removeDrive: () => request('DELETE', '/backups/drive'),
    /** Starts the restore; the server restarts itself a moment later. */
    restore: (fileName) => request('POST', '/backups/restore', { body: { fileName } }),
  },

  /** { status: 'ok' | 'warning' | 'error', warnings: string[], lastBackup }. Needs no login. */
  health: () => request('GET', '/health'),

  /** Fire-and-forget report of a browser error, stored next to the server log. */
  reportError: (report) => request('POST', '/client-log', { body: report }),
}
