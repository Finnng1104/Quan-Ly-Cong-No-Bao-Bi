import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildSeed } from '../data/mockData'
import * as api from '../api/mockApi'
import { fmtMoney, fmtQty, fmtDate } from '../lib/format'

const lookups = (s) => ({
  productName: (id) => s.products.find((p) => p.id === id)?.name || id,
  unitName: (id) => s.units.find((u) => u.id === id)?.name || id,
  customerName: (id) => s.customers.find((c) => c.id === id)?.name || id,
  fmtMoney,
  fmtQty,
  fmtDate,
})

const initialData = () => {
  const seed = buildSeed()
  return {
    ...seed,
    authed: false,
    username: '',
    password: '123456',
    settings: { showDebtOnTicket: true, shopName: 'Cửa Hàng Của Tôi', vatRate: 8 },
    orderDraft: null,
  }
}

export const useStore = create(
  persist(
    (set, get) => ({
      ...initialData(),

      // ---------- auth ----------
      login: (username, password) => {
        const ok = String(password) === String(get().password)
        if (ok) set({ authed: true, username })
        return ok
      },
      logout: () => set({ authed: false }),
      changePassword: (oldPw, newPw) => {
        if (String(oldPw) !== String(get().password)) return false
        set({ password: String(newPw) })
        return true
      },

      // ---------- settings ----------
      setShowDebtOnTicket: (v) => set((s) => ({ settings: { ...s.settings, showDebtOnTicket: v } })),
      setShopName: (v) => set((s) => ({ settings: { ...s.settings, shopName: v } })),
      setVatRate: (v) =>
        set((s) => ({ settings: { ...s.settings, vatRate: Math.max(0, Number(v) || 0) } })),

      // ---------- helpers ----------
      apply: (fn, ...args) => {
        const res = fn(get(), ...args)
        const { _created, ...patch } = res
        set(patch)
        return _created
      },

      // ---------- customers ----------
      addCustomer: (payload) => get().apply(api.createCustomer, payload),
      editCustomer: (id, payload) => get().apply(api.updateCustomer, id, payload),

      // ---------- products / units ----------
      addProduct: (name) => get().apply(api.createProduct, name),
      renameProduct: (id, name) => get().apply(api.updateProduct, id, name),
      removeProduct: (id) => get().apply(api.deleteProduct, id),
      addUnit: (name) => get().apply(api.createUnit, name),
      renameUnit: (id, name) => get().apply(api.updateUnit, id, name),
      removeUnit: (id) => get().apply(api.deleteUnit, id),

      // ---------- price book ----------
      setPrice: (args) => get().apply(api.setPrice, args),
      removePrice: (id) => get().apply(api.removePrice, id),
      copyPrices: (fromId, toId) => get().apply(api.copyPriceBook, fromId, toId),
      getPrice: (customerId, productId, unitId) => api.getPrice(get(), customerId, productId, unitId),

      // ---------- orders ----------
      saveOrder: (payload, editingId) => {
        if (editingId) {
          get().apply(api.updateOrder, editingId, payload, lookups(get()))
          return get().orders.find((o) => o.id === editingId)
        }
        return get().apply(api.createOrder, payload)
      },
      removeOrder: (id) => get().apply(api.deleteOrder, id),
      restoreOrder: (id) => get().apply(api.restoreOrder, id),

      // ---------- returns ----------
      addReturn: (payload) => get().apply(api.createReturn, payload),
      removeReturn: (id) => get().apply(api.deleteReturn, id),

      // ---------- payments ----------
      addPayment: (payload) => get().apply(api.createPayment, payload),
      removePayment: (id) => get().apply(api.deletePayment, id),

      // ---------- phát sinh công nợ tự do ----------
      addAdjustment: (payload) => get().apply(api.createAdjustment, payload),
      removeAdjustment: (id) => get().apply(api.deleteAdjustment, id),

      // ---------- statement ----------
      exportStatement: (payload) => get().apply(api.recordStatementExport, payload),
      lastExportOf: (customerId) => api.lastExportOf(get(), customerId),
      ordersEditedAfter: (customerId, ts) => api.ordersEditedAfter(get(), customerId, ts),

      // ---------- draft đơn đang nhập ----------
      setOrderDraft: (draft) => set({ orderDraft: draft }),
      clearOrderDraft: () => set({ orderDraft: null }),

      // ---------- reset demo ----------
      resetData: () => set({ ...initialData(), authed: get().authed }),
    }),
    {
      name: 'qlcn-store-v1',
      partialize: (s) => ({
        authed: s.authed,
        username: s.username,
        password: s.password,
        settings: s.settings,
        customers: s.customers,
        products: s.products,
        units: s.units,
        priceBook: s.priceBook,
        orders: s.orders,
        returns: s.returns,
        payments: s.payments,
        adjustments: s.adjustments,
        statementExports: s.statementExports,
        counters: s.counters,
        orderDraft: s.orderDraft,
      }),
    },
  ),
)

// ---------- selectors dùng chung ----------
export const useCustomer = (id) => useStore((s) => s.customers.find((c) => c.id === id))
export const productName = (s, id) => s.products.find((p) => p.id === id)?.name || '—'
export const unitName = (s, id) => s.units.find((u) => u.id === id)?.name || '—'
export const customerName = (s, id) => s.customers.find((c) => c.id === id)?.name || '—'
