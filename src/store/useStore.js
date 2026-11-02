import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/httpApi'
import { setUnauthorizedHandler } from '../api/client'

// The demo version kept all data (and the plaintext password) under this key. It is removed on
// start so nothing sensitive lingers in the browser.
const LEGACY_STORAGE_KEY = 'qlcn-store-v1'

const DEFAULT_SETTINGS = { shopName: 'Cửa Hàng Của Tôi', vatRate: 8, showDebtOnTicket: true }

/**
 * Global state is only what almost every screen needs: the session, shop settings and the short
 * lists used by pickers (customers, products, units). Everything else is fetched by the screen
 * that shows it, from the server.
 *
 * `dataVersion` goes up after every successful change; screens that load data from the server
 * depend on it so they refresh themselves after a save or delete.
 */
export const useStore = create(
  persist(
    (set, get) => {
      // An expired or revoked session sends the person to the login page.
      setUnauthorizedHandler(() => set({ authed: false }))

      const bump = () => set((s) => ({ dataVersion: s.dataVersion + 1 }))

      return {
        ready: false,
        bootError: null,
        authed: false,
        username: '',
        settings: DEFAULT_SETTINGS,
        customers: [],
        products: [],
        units: [],
        dataVersion: 0,
        // An order being typed survives a refresh; it is the only thing kept in the browser.
        orderDraft: null,

        // ---------- session ----------
        bootstrap: async () => {
          try {
            localStorage.removeItem(LEGACY_STORAGE_KEY)
          } catch {
            // Storage can be blocked; nothing to clean in that case.
          }

          set({ bootError: null })
          try {
            const me = await api.auth.me()
            set({ authed: true, username: me.username })
            await get().loadReferenceData()
          } catch (error) {
            if (error.code === 'UNAUTHENTICATED') set({ authed: false })
            else set({ bootError: error.message })
          } finally {
            set({ ready: true })
          }
        },

        loadReferenceData: async () => {
          const [settings, products, units, customers] = await Promise.all([
            api.settings.get(),
            api.products.list(),
            api.units.list(),
            api.customers.listAll(),
          ])
          set({ settings, products, units, customers })
        },

        login: async (username, password) => {
          const me = await api.auth.login(username, password)
          set({ authed: true, username: me.username })
          await get().loadReferenceData()
        },

        logout: async () => {
          try {
            await api.auth.logout()
          } catch {
            // The session may already be gone; the person is signed out locally either way.
          }
          set({ authed: false, username: '', customers: [], products: [], units: [] })
        },

        changePassword: (oldPassword, newPassword) => api.auth.changePassword(oldPassword, newPassword),

        // ---------- settings ----------
        setShopName: async (shopName) => set({ settings: await api.settings.update({ shopName }) }),
        setShowDebtOnTicket: async (showDebtOnTicket) =>
          set({ settings: await api.settings.update({ showDebtOnTicket }) }),
        setVatRate: async (vatRatePercent) =>
          set({ settings: await api.settings.update({ vatRatePercent }) }),

        // ---------- customers ----------
        refreshCustomers: async () => set({ customers: await api.customers.listAll() }),
        addCustomer: async (payload) => {
          const customer = await api.customers.create(payload)
          await get().refreshCustomers()
          bump()
          return customer
        },
        editCustomer: async (id, payload) => {
          const customer = await api.customers.update(id, payload)
          await get().refreshCustomers()
          bump()
          return customer
        },
        removeCustomer: async (id) => {
          await api.customers.remove(id)
          await get().refreshCustomers()
          bump()
        },

        // ---------- products / units ----------
        addProduct: async (name) => {
          const product = await api.products.create(name)
          set((s) => ({ products: [...s.products, product] }))
          return product
        },
        renameProduct: async (id, name) => {
          await api.products.rename(id, name)
          set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, name } : p)) }))
        },
        removeProduct: async (id) => {
          await api.products.remove(id)
          set((s) => ({ products: s.products.filter((p) => p.id !== id) }))
          bump()
        },
        addUnit: async (name) => {
          const unit = await api.units.create(name)
          set((s) => ({ units: [...s.units, unit] }))
          return unit
        },
        renameUnit: async (id, name) => {
          await api.units.rename(id, name)
          set((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, name } : u)) }))
        },
        removeUnit: async (id) => {
          await api.units.remove(id)
          set((s) => ({ units: s.units.filter((u) => u.id !== id) }))
          bump()
        },

        // ---------- price book ----------
        setPrice: async ({ customerId, productId, unitId, price }) => {
          const entry = await api.customers.setPrice(customerId, { productId, unitId, price })
          bump()
          return entry
        },
        removePrice: async (id) => {
          await api.prices.remove(id)
          bump()
        },
        copyPrices: async (fromId, toId) => {
          const entries = await api.customers.copyPrices(toId, fromId)
          bump()
          return entries
        },

        // ---------- documents ----------
        saveOrder: async (payload, editing) => {
          const order = editing
            ? await api.orders.update(editing.id, { ...payload, version: editing.version })
            : await api.orders.create(payload)
          bump()
          return order
        },
        removeOrder: async (id) => {
          await api.orders.remove(id)
          bump()
        },
        restoreOrder: async (id) => {
          await api.orders.restore(id)
          bump()
        },
        addReturn: async (payload) => {
          const record = await api.returns.create(payload)
          bump()
          return record
        },
        removeReturn: async (id) => {
          await api.returns.remove(id)
          bump()
        },
        addPayment: async (payload) => {
          const record = await api.payments.create(payload)
          bump()
          return record
        },
        removePayment: async (id) => {
          await api.payments.remove(id)
          bump()
        },
        addAdjustment: async (payload) => {
          const record = await api.adjustments.create(payload)
          bump()
          return record
        },
        removeAdjustment: async (id) => {
          await api.adjustments.remove(id)
          bump()
        },
        exportStatement: async (customerId, range) => {
          const record = await api.customers.recordStatementExport(customerId, range)
          bump()
          return record
        },

        // ---------- order draft ----------
        setOrderDraft: (draft) => set({ orderDraft: draft }),
        clearOrderDraft: () => set({ orderDraft: null }),
      }
    },
    {
      name: 'qlcn-draft-v1',
      partialize: (s) => ({ orderDraft: s.orderDraft }),
    },
  ),
)

// ---------- selectors shared by screens ----------
export const useCustomer = (id) => useStore((s) => s.customers.find((c) => c.id === id))
export const productName = (s, id) => s.products.find((p) => p.id === id)?.name || '—'
export const unitName = (s, id) => s.units.find((u) => u.id === id)?.name || '—'
export const customerName = (s, id) => s.customers.find((c) => c.id === id)?.name || '—'
