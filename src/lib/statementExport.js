// Turns a statement from GET /customers/:id/statement into a file the shop can send to a customer.

import { fmtDate, normalize } from './format'

/**
 * Rows for toCsv(). Amounts stay plain numbers (no thousands separator) so Excel can sum them.
 */
export function statementCsvRows(statement, { customerName, from, to }) {
  return [
    ['SAO KÊ CÔNG NỢ'],
    ['Khách hàng', customerName],
    ['Kỳ', `${fmtDate(from)} - ${fmtDate(to)}`],
    [],
    ['Ngày', 'Diễn giải', 'Tăng', 'Giảm', 'Dư nợ'],
    ['', 'Dư đầu kỳ', '', '', statement.opening],
    ...statement.rows.map((row) => [fmtDate(row.date), row.desc, row.up || '', row.down || '', row.balance]),
    ['', 'Dư cuối kỳ', '', '', statement.closing],
  ]
}

/** e.g. sao-ke-chi-lan-2026-09-01-2026-10-01.csv — no accents or spaces, so every OS and Zalo keep it intact. */
export function statementFileName(customerName, { from, to }, extension) {
  const slug = normalize(customerName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `sao-ke-${slug || 'khach'}-${from}-${to}.${extension}`
}
