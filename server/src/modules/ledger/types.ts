// Shapes mirror the records used by the web app (src/data/mockData.js), so the same fixtures and
// the original src/lib/debt.js can be run against this module in differential tests.

export type OrderLineKind = 'sell' | 'return'

export interface LedgerCustomer {
  id: string
  name?: string
  phone?: string
  openingDebt?: { amount: number; date: string } | null
}

export interface LedgerOrderLine {
  id: string
  /** Missing means 'sell', like old records. */
  type?: OrderLineKind
  productId: string
  unitId: string
  qty: number
  price: number
  amount?: number
}

export interface LedgerOrderFee {
  id: string
  name: string
  amount: number
}

export interface OrderEditRecord {
  editedAt: string
  oldTotal: number
  newTotal: number
  diff: number
  changes: string[]
}

export interface LedgerOrder {
  id: string
  code: string
  customerId: string
  date: string
  seq?: number
  total: number
  lines: LedgerOrderLine[]
  vat?: { rate?: number; amount: number; manual?: boolean } | null
  fees?: LedgerOrderFee[]
  note?: string
  editHistory?: OrderEditRecord[]
  lastEditAt?: string | null
  deletedAt?: string | null
}

export interface LedgerReturnLine {
  productId: string
  unitId: string
  qty: number
  price?: number
  amount?: number
}

export interface LedgerReturn {
  id: string
  customerId: string
  date: string
  seq?: number
  total: number
  lines: LedgerReturnLine[]
  deletedAt?: string | null
}

export interface LedgerPayment {
  id: string
  customerId: string
  date: string
  seq?: number
  amount: number
  deletedAt?: string | null
}

export interface LedgerAdjustment {
  id: string
  customerId: string
  date: string
  seq?: number
  /** Positive adds to the debt, negative reduces it. */
  amount: number
  note?: string
  deletedAt?: string | null
}

export interface LedgerData {
  customers: LedgerCustomer[]
  orders: LedgerOrder[]
  returns: LedgerReturn[]
  payments: LedgerPayment[]
  adjustments?: LedgerAdjustment[]
}
