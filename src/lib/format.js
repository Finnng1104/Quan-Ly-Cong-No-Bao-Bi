// ===== Định dạng số & ngày (tiền VND có dấu chấm, ngày dd/mm/yyyy) =====

const moneyFmt = new Intl.NumberFormat('vi-VN')

export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  return moneyFmt.format(Math.round(Number(n)))
}

// Always 3 decimals ("5,100"): the customer reads quantities this way, and the server stores 3 decimals.
// Must match formatQty in server/src/shared/format.ts so edit-history text reads the same.
const qtyFmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

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
