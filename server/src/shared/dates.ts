// Business dates are plain 'YYYY-MM-DD' strings, compared as text. All arithmetic below is done in
// UTC on purpose: calendar days must not shift with the machine's timezone or daylight saving.

export const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(iso: string): { year: number; month: number; day: number } {
  const match = ISO_DATE_PATTERN.exec(iso)
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: "${iso}"`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** True only for real calendar dates: rejects 2026-02-30 as well as malformed text. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function addDays(iso: string, days: number): string {
  const { year, month, day } = parts(iso)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return format(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

export function dayBefore(iso: string): string {
  return addDays(iso, -1)
}

/** First day of the month containing `iso`. */
export function monthStart(iso: string): string {
  const { year, month } = parts(iso)
  return format(year, month, 1)
}

/**
 * Same calendar day one year earlier; 29 Feb falls back to 28 Feb. This is the start of the
 * "last 12 months" window on statements (decision D-24).
 */
export function oneYearBefore(iso: string): string {
  const { year, month, day } = parts(iso)
  const previousYear = year - 1
  return format(previousYear, month, Math.min(day, daysInMonth(previousYear, month)))
}

/** Today's date in the shop's timezone, regardless of where the machine thinks it is. */
export function todayInShopZone(now: Date = new Date()): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
