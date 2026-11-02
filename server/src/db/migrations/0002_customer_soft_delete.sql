-- Customers are never hard-deleted: their orders, payments and returns must stay in the books.
-- A deleted customer disappears from lists and from every debt total.
ALTER TABLE customers ADD COLUMN deleted_at TEXT;

-- Same shape as in 0001, but a deleted customer contributes no events at all.
DROP VIEW ledger_events;
CREATE VIEW ledger_events AS
  SELECT branch_id, id AS customer_id, 'opening' AS kind, id AS ref_id, NULL AS code, NULL AS note,
         opening_debt_date AS date, -1 AS seq, 0 AS rank, opening_debt_amount AS delta
  FROM customers WHERE opening_debt_amount <> 0 AND deleted_at IS NULL
  UNION ALL
  SELECT branch_id, customer_id, 'order', id, code, NULL, date, seq, 1, total
  FROM orders
  WHERE deleted_at IS NULL AND customer_id IN (SELECT id FROM customers WHERE deleted_at IS NULL)
  UNION ALL
  SELECT branch_id, customer_id, 'adjust', id, code, note, date, seq, 2, amount
  FROM adjustments
  WHERE deleted_at IS NULL AND customer_id IN (SELECT id FROM customers WHERE deleted_at IS NULL)
  UNION ALL
  SELECT branch_id, customer_id, 'return', id, code, NULL, date, seq, 3, -total
  FROM returns
  WHERE deleted_at IS NULL AND customer_id IN (SELECT id FROM customers WHERE deleted_at IS NULL)
  UNION ALL
  SELECT branch_id, customer_id, 'payment', id, code, NULL, date, seq, 4, -amount
  FROM payments
  WHERE deleted_at IS NULL AND customer_id IN (SELECT id FROM customers WHERE deleted_at IS NULL);
