import { describe, expect, it } from 'vitest'
import { statementCsvRows, statementFileName } from './statementExport'
import { toCsv } from './format'

const statement = {
  opening: 1500000,
  rows: [
    { date: '2026-10-02', desc: 'Đơn HĐ-0001', up: 250000, down: 0, balance: 1750000 },
    { date: '2026-10-05', desc: 'Thu tiền; chuyển khoản', up: 0, down: 750000, balance: 1000000 },
  ],
  closing: 1000000,
}

describe('statementCsvRows', () => {
  it('lists opening, every row and closing with plain numbers', () => {
    const rows = statementCsvRows(statement, { customerName: 'Chị Lan', from: '2026-10-01', to: '2026-10-31' })

    expect(rows[2]).toEqual(['Kỳ', '01/10/2026 - 31/10/2026'])
    expect(rows.slice(4)).toEqual([
      ['Ngày', 'Diễn giải', 'Tăng', 'Giảm', 'Dư nợ'],
      ['', 'Dư đầu kỳ', '', '', 1500000],
      ['02/10/2026', 'Đơn HĐ-0001', 250000, '', 1750000],
      ['05/10/2026', 'Thu tiền; chuyển khoản', '', 750000, 1000000],
      ['', 'Dư cuối kỳ', '', '', 1000000],
    ])
  })

  it('still has opening and closing when the range has no activity', () => {
    const rows = statementCsvRows({ opening: 0, rows: [], closing: 0 }, { customerName: 'A', from: '2026-10-01', to: '2026-10-01' })
    expect(rows.slice(5)).toEqual([
      ['', 'Dư đầu kỳ', '', '', 0],
      ['', 'Dư cuối kỳ', '', '', 0],
    ])
  })

  it('keeps a description with the separator in one cell', () => {
    const csv = toCsv(statementCsvRows(statement, { customerName: 'A', from: '2026-10-01', to: '2026-10-31' }))
    expect(csv).toContain('"Thu tiền; chuyển khoản"')
  })
})

describe('statementFileName', () => {
  it('drops accents and spaces from the customer name', () => {
    expect(statementFileName('Chị Lan (Đà Lạt)', { from: '2026-10-01', to: '2026-10-31' }, 'csv')).toBe(
      'sao-ke-chi-lan-da-lat-2026-10-01-2026-10-31.csv',
    )
  })

  it('falls back when the name has no usable letters', () => {
    expect(statementFileName('***', { from: '2026-10-01', to: '2026-10-31' }, 'csv')).toBe(
      'sao-ke-khach-2026-10-01-2026-10-31.csv',
    )
  })
})
