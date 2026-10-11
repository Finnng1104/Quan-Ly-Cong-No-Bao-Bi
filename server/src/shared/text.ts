/**
 * Lowercase, accent-free form used for searching. Vietnamese people type names with or without
 * diacritics, and SQLite's LIKE cannot fold them, so we store and compare this normalised text.
 */
export function normalizeSearch(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim()
}
