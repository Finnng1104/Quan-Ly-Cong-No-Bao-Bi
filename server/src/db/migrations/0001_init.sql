-- Initial schema. Money is INTEGER VND; quantities are INTEGER milli-units (1.5 => 1500);
-- business dates are 'YYYY-MM-DD' text; timestamps are ISO-8601 UTC text ending in 'Z'.

CREATE TABLE branches (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  branch_id      TEXT REFERENCES branches(id),   -- NULL = not limited to one branch
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,                  -- scrypt$N$r$p$saltB64$hashB64
  role           TEXT NOT NULL DEFAULT 'owner',
  is_active      INTEGER NOT NULL DEFAULT 1,
  failed_logins  INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                 -- sha256 of the token held in the cookie
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  branch_id            TEXT PRIMARY KEY REFERENCES branches(id),
  shop_name            TEXT NOT NULL DEFAULT 'Cửa Hàng Của Tôi',
  vat_rate_bp          INTEGER NOT NULL DEFAULT 800,  -- 800 = 8%
  show_debt_on_ticket  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE counters (
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  name       TEXT NOT NULL,        -- order_no | return_no | payment_no | adjust_no | seq
  value      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, name)
);

CREATE TABLE customers (
  id                   TEXT PRIMARY KEY,
  branch_id            TEXT NOT NULL REFERENCES branches(id),
  name                 TEXT NOT NULL,
  search_text          TEXT NOT NULL,       -- normalised name + ' ' + phone, see normalizeSearch()
  phone                TEXT NOT NULL DEFAULT '',
  address              TEXT NOT NULL DEFAULT '',
  note                 TEXT NOT NULL DEFAULT '',
  opening_debt_amount  INTEGER NOT NULL DEFAULT 0,
  opening_debt_date    TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_customers_branch ON customers(branch_id, search_text);

CREATE TABLE products (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  name       TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE units (
  id         TEXT PRIMARY KEY,
  branch_id  TEXT NOT NULL REFERENCES branches(id),
  name       TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE price_book (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id  TEXT NOT NULL REFERENCES products(id),
  unit_id     TEXT NOT NULL REFERENCES units(id),
  price       INTEGER NOT NULL CHECK (price >= 0),
  UNIQUE (customer_id, product_id, unit_id)
);

CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  branch_id     TEXT NOT NULL REFERENCES branches(id),
  code          TEXT NOT NULL,                 -- HĐ-0001
  customer_id   TEXT NOT NULL REFERENCES customers(id),
  date          TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  vat_rate_bp   INTEGER,                       -- NULL when the order has no VAT
  vat_amount    INTEGER NOT NULL DEFAULT 0,
  vat_manual    INTEGER NOT NULL DEFAULT 0,
  fees_total    INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL,              -- computed by the server; negative if returns exceed sales
  note          TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,    -- optimistic locking, see PLAN D-25
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_edit_at  TEXT,
  deleted_at    TEXT,
  UNIQUE (branch_id, code)
);

CREATE TABLE order_lines (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('sell', 'return')),
  product_id  TEXT NOT NULL REFERENCES products(id),
  unit_id     TEXT NOT NULL REFERENCES units(id),
  qty_milli   INTEGER NOT NULL CHECK (qty_milli > 0),
  price       INTEGER NOT NULL CHECK (price >= 0),
  amount      INTEGER NOT NULL CHECK (amount >= 0)   -- always positive; the sign comes from `type`
);
CREATE INDEX idx_order_lines_order ON order_lines(order_id, position);

CREATE TABLE order_fees (
  id        TEXT PRIMARY KEY,
  order_id  TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  name      TEXT NOT NULL,
  amount    INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_order_fees_order ON order_fees(order_id, position);

CREATE TABLE order_edits (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  edited_at  TEXT NOT NULL,
  old_total  INTEGER NOT NULL,
  new_total  INTEGER NOT NULL,
  diff       INTEGER NOT NULL,
  changes    TEXT NOT NULL                  -- JSON array of Vietnamese sentences, never empty
);
CREATE INDEX idx_order_edits_order ON order_edits(order_id, edited_at);

CREATE TABLE returns (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  code        TEXT NOT NULL,                -- TH-0001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  total       INTEGER NOT NULL CHECK (total >= 0),
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (branch_id, code)
);

CREATE TABLE return_lines (
  id         TEXT PRIMARY KEY,
  return_id  TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_id    TEXT NOT NULL REFERENCES units(id),
  qty_milli  INTEGER NOT NULL CHECK (qty_milli > 0),
  price      INTEGER NOT NULL CHECK (price >= 0),
  amount     INTEGER NOT NULL CHECK (amount >= 0)
);
CREATE INDEX idx_return_lines_return ON return_lines(return_id, position);

CREATE TABLE payments (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  code        TEXT NOT NULL,                -- TT-0001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (branch_id, code)
);

CREATE TABLE adjustments (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  code        TEXT NOT NULL,                -- PS-0001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date        TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount <> 0),   -- signed: + adds to the debt, - reduces it
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  UNIQUE (branch_id, code)
);

-- Debt events are read per customer (ledger, balance) and per day (dashboard), so index both ways.
CREATE INDEX idx_orders_cust      ON orders(branch_id, customer_id, date, seq);
CREATE INDEX idx_orders_date      ON orders(branch_id, date);
CREATE INDEX idx_returns_cust     ON returns(branch_id, customer_id, date, seq);
CREATE INDEX idx_returns_date     ON returns(branch_id, date);
CREATE INDEX idx_payments_cust    ON payments(branch_id, customer_id, date, seq);
CREATE INDEX idx_payments_date    ON payments(branch_id, date);
CREATE INDEX idx_adjustments_cust ON adjustments(branch_id, customer_id, date, seq);
CREATE INDEX idx_adjustments_date ON adjustments(branch_id, date);

CREATE TABLE statement_exports (
  id          TEXT PRIMARY KEY,
  branch_id   TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL,
  exported_at TEXT NOT NULL
);
CREATE INDEX idx_statement_exports_cust ON statement_exports(customer_id, exported_at);

CREATE TABLE backup_runs (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  trigger     TEXT NOT NULL,               -- startup | periodic | pre-update | pre-restore | manual
  destination TEXT NOT NULL,
  status      TEXT NOT NULL,               -- running | ok | failed
  size_bytes  INTEGER,
  file_name   TEXT,
  error       TEXT
);

-- One row per thing that changes a customer's debt, in a shape that can be summed and windowed.
-- `rank` breaks ties for legacy rows that share date and seq (see KIND_RANK in the ledger module).
CREATE VIEW ledger_events AS
  SELECT branch_id, id AS customer_id, 'opening' AS kind, id AS ref_id, NULL AS code, NULL AS note,
         opening_debt_date AS date, -1 AS seq, 0 AS rank, opening_debt_amount AS delta
  FROM customers WHERE opening_debt_amount <> 0
  UNION ALL
  SELECT branch_id, customer_id, 'order', id, code, NULL, date, seq, 1, total
  FROM orders WHERE deleted_at IS NULL
  UNION ALL
  SELECT branch_id, customer_id, 'adjust', id, code, note, date, seq, 2, amount
  FROM adjustments WHERE deleted_at IS NULL
  UNION ALL
  SELECT branch_id, customer_id, 'return', id, code, NULL, date, seq, 3, -total
  FROM returns WHERE deleted_at IS NULL
  UNION ALL
  SELECT branch_id, customer_id, 'payment', id, code, NULL, date, seq, 4, -amount
  FROM payments WHERE deleted_at IS NULL;

-- Single default branch and its settings/counters (D-10: room for more branches later).
INSERT INTO branches (id, name, is_default, created_at)
VALUES ('main', 'Chi nhánh chính', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO settings (branch_id) VALUES ('main');

INSERT INTO counters (branch_id, name, value) VALUES
  ('main', 'order_no', 0),
  ('main', 'return_no', 0),
  ('main', 'payment_no', 0),
  ('main', 'adjust_no', 0),
  ('main', 'seq', 0);
