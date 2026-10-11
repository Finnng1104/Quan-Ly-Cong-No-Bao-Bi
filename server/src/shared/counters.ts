import type { Database } from '../db/client.js'

export type CounterName = 'order_no' | 'return_no' | 'payment_no' | 'adjust_no' | 'seq'

/**
 * Atomically increments a per-branch counter and returns the new value.
 * Must run inside the same transaction that uses the value, so a rolled-back document does not
 * leave a hole in the numbering and two requests can never receive the same number.
 */
export function nextCounter(db: Database, branchId: string, name: CounterName): number {
  const row = db
    .prepare(
      `INSERT INTO counters (branch_id, name, value) VALUES (?, ?, 1)
       ON CONFLICT (branch_id, name) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .get(branchId, name) as { value: number }
  return row.value
}

/** HĐ-0007: the prefix, a dash and at least 4 digits (grows naturally past 9999). */
export function formatCode(prefix: 'HĐ' | 'TH' | 'TT' | 'PS', number: number): string {
  return `${prefix}-${String(number).padStart(4, '0')}`
}
