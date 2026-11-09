// ===== Định dạng số & ngày (tiền VND có dấu chấm, ngày dd/mm/yyyy) =====

const moneyFmt = new Intl.NumberFormat('vi-VN')

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  return moneyFmt.format(Math.round(Number(n)))
}

// ===== Unit prices: up to 3 decimals, typed with a comma ("5.250,5") =====
// The form keeps the price as the text the person typed, with "," as the decimal mark and no
// thousand dots; the dots are only added for display.

const priceFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })
const PRICE_MAX_DECIMALS = 3

/** Price number -> display text: 5250 -> "5.250", 0.5 -> "0,5". */
export function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  return priceFmt.format(Number(n))
}

/** Raw text from the input -> clean text: only digits and one comma, at most 3 decimals. */
export function sanitizePriceInput(text) {
  const [integerPart, ...rest] = String(text).replace(/\./g, '').replace(/[^0-9,]/g, '').split(',')
  if (rest.length === 0) return integerPart
  return `${integerPart},${rest.join('').slice(0, PRICE_MAX_DECIMALS)}`
}

/** Clean text -> what the input shows: "5250,5" -> "5.250,5". Keeps a trailing comma while typing. */
export function formatPriceInput(clean) {
  if (!clean) return ''
  const [integerPart, decimalPart] = String(clean).split(',')
  const grouped = integerPart ? priceFmt.format(Number(integerPart)) : '0'
  return decimalPart === undefined ? grouped : `${grouped},${decimalPart}`
}

/** Price number from the server -> clean input text: 5250.5 -> "5250,5". */
export function priceToInput(n) {
  return n === null || n === undefined || n === '' ? '' : String(n).replace('.', ',')
}

/** Clean input text -> number: "5250,5" -> 5250.5 */
export function parsePrice(clean) {
  if (!clean) return 0
  const n = Number(String(clean).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// Up to the 3 decimals the server stores, without trailing zeros ("5,1", "5,125", "5").
// Must match formatQty in server/src/shared/format.ts so edit-history text reads the same.
const qtyFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })

export function fmtQty(n) {
  if (n === null || n === undefined) return ''
  return qtyFmt.format(Number(n))
}

// 'YYYY-MM-DD' -> 'dd/mm/yyyy'
export function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`
}

export function todayISO() {
  return toISO(new Date())
}

export function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function dayBeforeISO(iso) {
  return addDaysISO(iso, -1)
}

export function monthOf(iso) {
  return String(iso).slice(0, 7)
}

// parse "12.500" / "12,5" / "12500" -> number
export function parseNum(s) {
  if (s === null || s === undefined || s === '') return 0
  if (typeof s === 'number') return s
  const t = String(s).replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

// quantity typed in a form: "1,5" and "1.5" both mean one and a half
export function parseQty(s) {
  if (s === null || s === undefined || s === '') return 0
  const n = Number(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim()
}

/** Tải một file text/CSV về máy (dùng cho xuất dữ liệu). */
export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Xuất CSV tiếng Việt mở được bằng Excel (BOM UTF-8 + dấu ';' phân cách). */
export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return s.includes(';') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
}

/** Reads a `?ngay=YYYY-MM-DD` filter from the URL; anything else counts as "no filter". */
export function dateFromSearchParams(searchParams) {
  const value = searchParams.get('ngay') ?? ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}
