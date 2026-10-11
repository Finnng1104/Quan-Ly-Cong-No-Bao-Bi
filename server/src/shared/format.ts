// Display formatting used inside server-rendered text (order edit history). It must produce the
// same strings as the web app's `src/lib/format.js`, so old and new history entries read alike.

const moneyFormat = new Intl.NumberFormat('vi-VN')
const qtyFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 })

/** 12500 -> "12.500" */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '0'
  return moneyFormat.format(Math.round(Number(value)))
}

/** 1.5 -> "1,5" (at most 2 decimals) */
export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return qtyFormat.format(Number(value))
}

/** "2026-10-11" -> "11/10/2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = String(iso).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}
