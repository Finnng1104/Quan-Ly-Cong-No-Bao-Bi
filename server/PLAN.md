# Kế hoạch Backend — Quản lý công nợ bao bì (cài local cho khách)

> Trạng thái: **ĐÃ REVIEW, CHỐT VÀ TRIỂN KHAI (Phase 0b mới thử trên macOS; chưa có Windows; Phase 7 chưa làm)** — xem "Tiến độ triển khai" ngay dưới.
> Soạn 2026-10-11 → review (Opus) → Finn chốt toàn bộ cùng ngày. Người giao việc: Finn (làm BE).
> Tài liệu này tự đủ: người triển khai không cần đọc lại cuộc trò chuyện. **Đây là nguồn chân lý duy nhất.**

## Tiến độ triển khai (cập nhật 2026-10-12, sau khi làm 0b)

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 0a Khung server | Xong | |
| 0b Đóng gói / cài đặt / cập nhật | **macOS: xong và đã thử thật.** Windows: đã viết, **chưa chạy trên Windows thật**. CI: đã viết, chưa chạy | Chi tiết và bảng "đã thử / chưa thử" ở `server/packaging/README.md` |
| 1 Lõi miền + differential | Xong | |
| 2 Auth, danh mục, khách, bảng giá | Xong | |
| 3 Đơn, trả, thu, phát sinh | Xong | |
| 4 API đọc + đối chiếu | Xong | Differential qua HTTP với 40 bộ dữ liệu ngẫu nhiên |
| 5 Backup, restore, chẩn đoán, log | Xong | Ký SigV4 khớp ví dụ chính thức của AWS; **chưa thử với R2 thật** |
| 6a/6b/6c Nối giao diện | Xong | HTTP-only, không có cờ `VITE_API_MODE` (xem lệch so với plan) |
| 7 Hoàn thiện / thí điểm | Chưa làm | |

**Lệch so với plan khi triển khai** (đều có lý do, cần Finn biết):
- **D-20 đổi từ ed25519 sang ECDSA P-256 + SHA-256.** Installer phải kiểm chữ ký TRƯỚC khi chạy bất cứ thứ gì
  tải về, mà Windows PowerShell 5.1 và LibreSSL của macOS đều không kiểm được ed25519. ECDSA P-256 kiểm được
  bằng `openssl` (macOS) và CNG/.NET (Windows), cùng `node:crypto` trong app. Vẫn 2 khóa công khai (chính + dự phòng).
- Gói phát hành là `.tar.gz` cho cả 3 nền tảng (Windows 10+ có `tar.exe`), không phải zip như §11.1.
- `backup` có thêm `--trigger pre-update` và in dòng `BACKUP_FILE=...` để installer biết file cần khôi phục.
- Chưa làm: app tự kiểm tra bản mới (`/api/system/update-status`) và dải báo "có bản mới" trong giao diện (Phase 7).
- Phase 6: bỏ cờ `VITE_API_MODE=mock|http`. Giữ hai chế độ sẽ gấp đôi việc mà 6c lại xóa mock; FE chuyển thẳng sang HTTP.
  `src/api/mockApi.js`, `src/data/mockData.js`, `src/lib/debt.js` được giữ lại chỉ làm bản đối chiếu cho test của `server/`.
- Khởi động: nếu `quick_check` báo DB hỏng thì server **không khởi động** (mã thoát riêng, supervisor không lặp lại).
- `GET /api/health` (có tiền tố `/api`), trả 503 khi DB lỗi; thêm `status: "warning"` khi quá 48h chưa backup.
- Upload S3/R2 tự viết bằng `node:crypto` + `fetch` (không thêm gói).
- Thêm `priceCount` vào danh sách khách (màn "Sao chép bảng giá" cần).
- Sửa vài lỗi sẵn có của FE khi nối: nút xuất CSV ở trang Khách dùng biến `toast` chưa khai báo; ô số lượng
  nhập "1,5" bị coi là 0; "N khách còn nợ" chỉ đếm tối đa 5.

## 0. Cách dùng tài liệu này

- **Implementer**: làm đúng thứ tự phase ở §12. Mỗi phase có "điều kiện nghiệm thu"; chưa đạt thì chưa sang phase sau. Đọc §15 (quy ước) trước khi viết code.
- Mọi quyết định trong §2 đã **[CHỐT]**. Gặp điều tài liệu không nói, hoặc thấy một quyết định sai khi đụng code thật → **dừng và hỏi Finn**, không tự quyết.
- Nhãn còn dùng: **[CHƯA BIẾT]** = thiếu thông tin từ khách, không chặn việc code.
- Trước khi làm một endpoint đọc, **mở trang FE tương ứng** (đã ghi ở §7) để đối chiếu dạng dữ liệu.

---

## 1. Bối cảnh và mục tiêu

### 1.1 Hiện trạng
Repo là **frontend thuần**: React 19 + Vite + Zustand (persist `localStorage`) + Tailwind 4 + PWA, test Vitest (26 test pass). Chưa có server, DB, auth thật. **Khách chưa dùng bản hiện tại với dữ liệu thật → bắt đầu từ DB trắng.**

Hợp đồng dữ liệu hiện tại:
- `src/api/mockApi.js` — hàm thuần `(state, payload) => patch`, "giai đoạn 2 thay bằng fetch()".
- `src/lib/debt.js` — toàn bộ logic công nợ (hàm thuần, có test).
- `src/store/useStore.js` — các action FE gọi qua `apply(mockApi.fn)`.
- `src/data/mockData.js` — dữ liệu mẫu, thể hiện hình dạng record.

### 1.2 Sản phẩm làm gì
Chủ một cửa hàng bao bì/giấy/băng keo theo dõi công nợ khách: lập đơn (giá riêng từng khách), hàng trả, thu tiền, phát sinh (ship, bớt nợ), xem dư nợ, sao kê, in hóa đơn. Công nợ **gộp theo khách**; thu tiền trừ thẳng nợ chung, không phân bổ theo đơn; dư nợ luôn **tính lại** từ phát sinh, không lưu số dư.

### 1.3 Bốn yêu cầu của Finn (ưu tiên cao nhất)
1. **Cài đặt và cập nhật bằng 1–2 câu lệnh** trên máy khách.
2. **Chạy ổn định, mượt** trên máy khách (Windows hoặc macOS — chưa biết, hỗ trợ cả hai).
3. **Backup được** (cloud, mặc định Cloudflare R2; đích khác cắm được).
4. **Log** đủ để debug lỗi, quá trình chạy, cài đặt, cập nhật.

### 1.4 Ngoài phạm vi (không làm)
Portal cho khách · đa vai trò/phân quyền thật · nhiều chi nhánh thật (chỉ chừa chỗ) · offline-sync · nhắc nợ Zalo/SMS · BE sinh PDF/Excel (FE tự in/CSV) · truy cập qua điện thoại bằng WiFi · giao source cho khách · **nhập dữ liệu cũ** · **nút "Cập nhật" trên giao diện** · **API backup/chẩn đoán qua web** (dùng CLI) · **sắp xếp khách theo tên** · khôi phục (restore) cho phiếu trả/thu/phát sinh (chỉ đơn hàng có, như hiện trạng).

---

## 2. Nhật ký quyết định (tất cả [CHỐT])

### 2.1 Phạm vi và nghiệp vụ
| # | Quyết định |
|---|---|
| D-01 | Phạm vi = đúng UI + hợp đồng `mockApi` hiện có, không vẽ thêm |
| D-02 | Một shop, một vai trò (chủ shop); không portal khách |
| D-03 | Giữ cả 2 đường hàng trả (phiếu `TH-` và dòng `return` trong hóa đơn) |
| D-04 | Không khóa sổ sau khi xuất sao kê; cho sửa, ghi lịch sử |
| D-05 | Không chặn trả vượt / thu dư / nợ âm (chỉ FE cảnh báo) |
| D-06 | Xóa sản phẩm/quy cách = **xóa mềm** |
| D-07 | **Cài local** trên máy khách; chỉ dùng trên máy đó, không mở cho điện thoại |
| D-08 | Múi giờ cố định `Asia/Ho_Chi_Minh` |
| D-22 | **Sửa đơn mà không có thay đổi thì KHÔNG ghi lịch sử, KHÔNG đổi `last_edit_at`** (cố ý khác `mockApi`, vốn luôn ghi → sao kê báo "Đã điều chỉnh" oan) |
| D-23 | **Xuất công nợ (CSV)**: cột nợ đầu kỳ = 0 khi ngày nợ đầu kỳ > `asOf`, để `opening + orders − returns − payments + adjust = end` luôn đúng (sửa lỗi của `customerDebtRows`) |
| D-24 | **"Hàng lấy 12 tháng"** = các đơn có ngày trong `[to − 1 năm, to]` (FE cũ lệch 1 ngày do `toISOString()`; không chép lỗi) |
| D-25 | **Chống ghi đè đơn**: `orders.version`; `PUT` gửi `version`, lệch → 409 |
| D-26 | **Lịch sử sửa đơn lưu `changes: string[]`** do server render bằng `diffOrders` đã port — đúng như FE hiện hiển thị (`OrderDetailPage.jsx:189`), FE không phải sửa |
| D-31 | Mật khẩu tối thiểu **4 ký tự** (khớp FE) |
| D-32 | Bắt đầu từ DB trắng, không có chức năng nhập dữ liệu cũ |

### 2.2 Kiến trúc và kỹ thuật
| # | Quyết định |
|---|---|
| D-09 | BE ở `server/` cùng repo, `package.json` riêng, **không dùng workspace** |
| D-10 | Chừa chỗ mở rộng: cột `branch_id`, bảng `users` (cột `role`), hàm `can()`, repository gắn phạm vi |
| D-11 | API đọc do BE tính và phân trang; FE chuyển từng màn hình |
| D-12 | Node.js **22 LTS** (khớp máy dev) + TypeScript + Fastify + SQLite (`better-sqlite3`). Node 22 hết hỗ trợ **30/04/2027** → phải phát hành bản nâng runtime lên LTS mới trước mốc đó (xem R14) |
| D-13 | **SQL viết tay + trình migration tự viết** (không Drizzle/Prisma). Bắt buộc: prepared statement, migration có checksum, repo có kiểu |
| D-14 | Hash mật khẩu bằng `scrypt` của Node, đặt `maxmem` tường minh 64 MiB |
| D-15 | Dư nợ tính qua `VIEW ledger_events`, không có bảng cache số dư |
| D-16 | `qty` lưu integer ×1000 (`qty_milli`); VAT rate lưu basis points (`bp`) |

### 2.3 Đóng gói, vận hành, bảo mật
| # | Quyết định |
|---|---|
| D-18 | Đóng gói = bundle (Node runtime + app + SQLite native) theo từng OS; build `node_modules` bằng **chính binary Node sẽ bundle** |
| D-19 | Windows: **Task Scheduler** (cấu hình bắt buộc ở §11.4) + **supervisor trong Node**; Mac: launchd LaunchAgent + cùng supervisor |
| D-20 | Manifest cập nhật ký **ed25519**, nhúng **2 public key** (chính + dự phòng), làm ngay từ Phase 0 |
| D-21 | Backup local + đích cloud S3-compatible; **không mã hóa phía client** mặc định; báo khách biết bản backup nằm trong tài khoản cloud của Finn |
| D-27 | R2: **mỗi shop một bucket** + token chỉ có quyền trên bucket đó; xóa bản cũ bằng **lifecycle rule** của bucket |
| D-28 | Backup chạy theo **sự kiện** (khởi động / có ghi dữ liệu), không theo giờ cố định (máy shop thường tắt ban đêm) |
| D-29 | Server chạy dưới **`NT AUTHORITY\LocalService`** (Windows), không `SYSTEM`. Hệ quả: cập nhật **chỉ qua lệnh admin** |
| D-30 | **Cổng cố định** chọn lúc cài, lưu vào config, không bao giờ tự đổi lúc chạy (PWA + cookie gắn với origin) |
| D-33 | Bảo mật localhost: allowlist header `Host`, `Origin` khớp chính xác cả cổng, cookie `qlcn_sid`, khóa đăng nhập theo username |
| D-35 | (2026-10-13) Chạy online cho khách thử: chỉ bật khi có `QLCN_PUBLIC_URLS` (https) — nghe `0.0.0.0`, cổng theo `PORT`, thêm các địa chỉ đó vào allowlist Host/Origin của D-33, cookie `Secure`, tài khoản đầu từ `QLCN_ADMIN_*`. Không có biến thì bản cài local giữ nguyên D-33. Cách deploy: `DEPLOY.md` |
| D-34 | Log: `pino` + `pino-roll`; chẩn đoán chỉ qua CLI `doctor` |

---

## 3. Tech stack và dependency

**Từng gói vẫn phải hỏi Finn trước khi `npm install`** (quy tắc của Finn). Danh sách dưới đây đã được đồng ý về hướng; implementer liệt kê đúng tên + phiên bản khi xin cài.

| Gói | Dùng cho | Ghi chú |
|---|---|---|
| Node.js **22 LTS** (bundle) | Runtime | Cùng major với máy dev (v22.23.3); ghim bằng `server/.nvmrc` và `engines`. Phase 0b kiểm prebuilt `better-sqlite3` cho Node 22 trên cả 3 target |
| `typescript`, `tsx`, `vitest` (dev) | Build, chạy dev, test | TS `strict` |
| `fastify`, `@fastify/cookie`, `@fastify/static` | HTTP, cookie, phục vụ FE build | `pino` đi kèm Fastify |
| `pino-roll` | Xoay vòng log theo ngày | Không tự viết (khóa file trên Windows) |
| `zod` | Validate request | |
| `better-sqlite3` | SQLite đồng bộ | Native; build trên CI từng OS/arch |
| (Phase 5) client S3 nhẹ | Upload R2/S3 | Chọn gói nhỏ nhất (vd `aws4fetch`), không `@aws-sdk/*`; chốt khi tới Phase 5 |

Không dùng: Prisma, Drizzle, `argon2`, NSSM, Puppeteer/thư viện PDF, thư viện zip.

---

## 4. Cấu trúc thư mục `server/`

```
server/
  package.json, tsconfig.json, vitest.config.ts
  PLAN.md                      # file này
  src/
    main.ts                    # CLI: serve | supervise | migrate | init-admin | backup | restore | doctor | version
    supervisor.ts              # tiến trình cha: spawn server, tự chạy lại có backoff, ghi log crash
    app.ts                     # dựng Fastify, đăng ký module, hook Host/Origin, error handler
    config/                    # đọc config.json + env, đường dẫn dữ liệu theo OS
    db/
      client.ts                # mở SQLite + PRAGMA
      migrate.ts               # trình chạy migration (checksum, transaction)
      migrations/0001_init.sql ...
    shared/
      money.ts                 # lineAmount, vat (BigInt, làm tròn half-up)
      dates.ts                 # today() theo Asia/Ho_Chi_Minh, validate YYYY-MM-DD, minusOneYear
      text.ts                  # normalizeSearch (giống normalize() của FE)
      errors.ts                # AppError + mã lỗi
      policy.ts                # can(user, action, resource)
      scope.ts                 # gắn branch_id vào truy vấn
    modules/
      auth/ settings/ customers/ catalog/ price-book/
      orders/ returns/ payments/ adjustments/
      ledger/                  # port từ src/lib/debt.js (thuần) + diffOrders (render chuỗi)
      reports/                 # dashboard, customer-debts
      system/                  # health, backup, restore, doctor, client-log
  test/
    fixtures/seed.ts           # dựng lại dữ liệu mẫu giống mockData.js
    differential/              # sinh dữ liệu ngẫu nhiên, so với src/lib/debt.js
  packaging/
    build-release.mjs          # tạo zip cho từng OS
    sign-manifest.mjs
    install.ps1, install.sh
    task-windows.xml           # định nghĩa Task Scheduler
    launchagent.plist
```

Mỗi module có: `routes.ts` (HTTP + zod), `service.ts` (nghiệp vụ), `repo.ts` (SQL), `*.test.ts`. Không tạo lớp trừu tượng dùng chung trước lần lặp thứ 3.

---

## 5. Mô hình dữ liệu (SQLite)

### 5.1 Quy ước
- ID: `TEXT`, `crypto.randomUUID()`.
- **Tiền = INTEGER VND**, không bao giờ REAL.
- Ngày nghiệp vụ: `TEXT 'YYYY-MM-DD'`. Timestamp: `TEXT` ISO-8601 **UTC có `Z`**, luôn do server sinh.
- Xóa mềm: `deleted_at TEXT NULL`; truy vấn nghiệp vụ lọc `deleted_at IS NULL`.
- Mọi bảng nghiệp vụ có `branch_id`; hiện chỉ có 1 chi nhánh mặc định.
- Mỗi kết nối: `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`

### 5.2 DDL (`0001_init.sql`)

```sql
CREATE TABLE branches (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  branch_id TEXT REFERENCES branches(id),           -- NULL = không giới hạn chi nhánh
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,                       -- scrypt$N$r$p$saltB64$hashB64
  role TEXT NOT NULL DEFAULT 'owner',
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                               -- sha256 của token trong cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);

CREATE TABLE settings (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id),
  shop_name TEXT NOT NULL DEFAULT 'Cửa Hàng Của Tôi',
  vat_rate_bp INTEGER NOT NULL DEFAULT 800,          -- 800 = 8%
  show_debt_on_ticket INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE counters (
  branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,                                -- order_no | return_no | payment_no | adjust_no | seq
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (branch_id, name)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL,
  search_text TEXT NOT NULL,                         -- normalizeSearch(name + ' ' + phone)
  phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  opening_debt_amount INTEGER NOT NULL DEFAULT 0,
  opening_debt_date TEXT NOT NULL,                   -- mặc định = hôm nay (giờ HCM) nếu không gửi
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_customers_branch ON customers(branch_id, search_text);

CREATE TABLE products (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE units (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  name TEXT NOT NULL, deleted_at TEXT
);

CREATE TABLE price_book (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  price INTEGER NOT NULL CHECK (price >= 0),
  UNIQUE (customer_id, product_id, unit_id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL,                                -- HĐ-0001
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL, seq INTEGER NOT NULL,
  vat_rate_bp INTEGER,                               -- NULL nếu không VAT
  vat_amount INTEGER NOT NULL DEFAULT 0,
  vat_manual INTEGER NOT NULL DEFAULT 0,
  fees_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,                            -- server tính; có thể âm nếu trả > bán
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,                -- D-25
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_edit_at TEXT, deleted_at TEXT,
  UNIQUE (branch_id, code)
);

CREATE TABLE order_lines (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sell','return')),
  product_id TEXT NOT NULL REFERENCES products(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),  -- 1.5 => 1500
  price INTEGER NOT NULL CHECK (price >= 0),
  amount INTEGER NOT NULL CHECK (amount >= 0)        -- luôn dương; dấu do type quyết định
);
CREATE TABLE order_fees (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0)
);
CREATE TABLE order_edits (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  edited_at TEXT NOT NULL, old_total INTEGER NOT NULL, new_total INTEGER NOT NULL,
  diff INTEGER NOT NULL,
  changes TEXT NOT NULL                              -- JSON array of strings (D-26), không bao giờ rỗng (D-22)
);
CREATE INDEX idx_order_edits_order ON order_edits(order_id, edited_at);

CREATE TABLE returns (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL, seq INTEGER NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0), reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, deleted_at TEXT, UNIQUE (branch_id, code)
);
CREATE TABLE return_lines (
  id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id), unit_id TEXT NOT NULL REFERENCES units(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  price INTEGER NOT NULL CHECK (price >= 0), amount INTEGER NOT NULL CHECK (amount >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL, seq INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0), note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, deleted_at TEXT, UNIQUE (branch_id, code)
);
CREATE TABLE adjustments (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL, seq INTEGER NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),       -- có dấu: + cộng nợ, − trừ nợ
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, deleted_at TEXT, UNIQUE (branch_id, code)
);

-- Index cho 4 bảng phát sinh: theo khách (sổ công nợ, dư nợ 1 khách) và theo ngày (tổng hợp mọi khách)
CREATE INDEX idx_orders_cust      ON orders(branch_id, customer_id, date, seq);
CREATE INDEX idx_orders_date      ON orders(branch_id, date);
CREATE INDEX idx_returns_cust     ON returns(branch_id, customer_id, date, seq);
CREATE INDEX idx_returns_date     ON returns(branch_id, date);
CREATE INDEX idx_payments_cust    ON payments(branch_id, customer_id, date, seq);
CREATE INDEX idx_payments_date    ON payments(branch_id, date);
CREATE INDEX idx_adjustments_cust ON adjustments(branch_id, customer_id, date, seq);
CREATE INDEX idx_adjustments_date ON adjustments(branch_id, date);

CREATE TABLE statement_exports (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, exported_at TEXT NOT NULL
);
CREATE INDEX idx_statement_exports_cust ON statement_exports(customer_id, exported_at);

CREATE TABLE backup_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
  trigger TEXT NOT NULL,                             -- startup | periodic | pre-update | manual
  destination TEXT NOT NULL, status TEXT NOT NULL,   -- running | ok | failed
  size_bytes INTEGER, file_name TEXT, error TEXT
);

CREATE VIEW ledger_events AS
  SELECT branch_id, id AS customer_id, 'opening' AS kind, id AS ref_id, NULL AS code, NULL AS note,
         opening_debt_date AS date, -1 AS seq, 0 AS rank, opening_debt_amount AS delta
  FROM customers WHERE opening_debt_amount <> 0
  UNION ALL SELECT branch_id, customer_id, 'order',   id, code, NULL, date, seq, 1,  total   FROM orders      WHERE deleted_at IS NULL
  UNION ALL SELECT branch_id, customer_id, 'adjust',  id, code, note, date, seq, 2,  amount  FROM adjustments WHERE deleted_at IS NULL
  UNION ALL SELECT branch_id, customer_id, 'return',  id, code, NULL, date, seq, 3, -total   FROM returns     WHERE deleted_at IS NULL
  UNION ALL SELECT branch_id, customer_id, 'payment', id, code, NULL, date, seq, 4, -amount  FROM payments    WHERE deleted_at IS NULL;
```

### 5.3 Ghi chú
1. **`qty_milli`**: SQLite không có `decimal`; dữ liệu có 0.5, 1.5. Tối đa 3 chữ số thập phân.
2. **`amount` luôn dương**, dấu do `type`/bảng quyết định (đúng `mockApi`).
3. **`rank`** lấy từ `KIND_RANK` của `debt.js`.
4. **`search_text`**: SQLite `LIKE` không bỏ dấu tiếng Việt; FE lọc trên `normalize(name + ' ' + phone)`. Server dùng cùng thuật toán (NFD, bỏ dấu, `đ→d`, lower, trim) và **cập nhật mỗi khi đổi tên/SĐT**.
5. **Xóa mềm sản phẩm/quy cách**: FK không bao giờ mồ côi. Ẩn khỏi danh sách chọn và khỏi bảng giá; đơn cũ vẫn hiện đúng tên.
6. Mã phiếu không bao giờ cấp lại (bộ đếm chỉ tăng) → `UNIQUE (branch_id, code)` không xung đột với xóa mềm.
7. `ledger_events.desc` được dựng ở app: `opening` → "Nợ đầu kỳ"; `order` → "Đơn hàng {code}"; `return` → "Trả hàng"; `payment` → "Thanh toán"; `adjust` → `note` hoặc "Phát sinh cộng nợ"/"Phát sinh trừ nợ" theo dấu (đúng `eventsFor`).

---

## 6. Quy tắc nghiệp vụ (nguồn: `src/lib/debt.js`, `src/api/mockApi.js`, trừ chỗ ghi "cố ý khác")

### 6.1 Công thức dư nợ
`balance(customer, X) = Σ delta` của mọi sự kiện có `date <= X`:
`opening` +nợ đầu kỳ (chỉ khi ≠ 0) · `order` +total · `adjust` +amount (có dấu) · `return` −total · `payment` −amount.

### 6.2 Thứ tự sự kiện
`(date ASC, seq ASC, rank ASC)`. `seq` là bộ đếm theo chi nhánh, gán lúc tạo, **giữ nguyên khi sửa đơn** (kể cả đổi ngày). `opening` có `seq = -1`.

**Không port lỗi** `(KIND_RANK[a.kind] || 9)` của `cmpEvent` (rank 0 bị biến thành 9). Hiện vô hại vì `opening` có `seq = -1`, nhưng bản TS so sánh rank đúng.

**Nợ cũ của một đơn** = tổng `delta` của mọi sự kiện cùng khách đứng *trước* đơn đó theo thứ tự trên (không tính chính nó); SQL: `(date, seq, rank) < (order.date, order.seq, 1)`. **Nợ mới** = nợ cũ + `total`.

### 6.3 Tính tiền đơn (server tự tính, bỏ qua `total`/`amount` FE gửi)
- `line.amount = round_half_up(qty_milli × price / 1000)` — **BigInt** cho phép nhân.
- `sellTotal = Σ amount (type=sell)`; `lineTotal = Σ (return ? −amount : +amount)`.
- VAT (chỉ khi bật): có `amount` → `manual = true`, dùng đúng số đó; không có → `round_half_up(sellTotal × rate_bp / 10000)`, **chỉ tính trên hàng bán**. Thiếu rate → `settings.vat_rate_bp`.
- `fees`: bỏ khoản `amount <= 0`; tên rỗng → `'Chi phí'`.
- `total = lineTotal + vat_amount + fees_total`.
- Đối chiếu FE (`Math.round` trên float): với **8%** kết quả luôn trùng (phần lẻ của `sellTotal × 0.08` là bội của 0.04, không bao giờ sát .5). Tỷ lệ khác hoặc số lượng thập phân hiếm có thể lệch 1 VND → **số của server là chuẩn**, FE hiển thị số server trả về sau khi lưu.

### 6.4 Mã phiếu và `seq`
Trong **một transaction**: tăng `counters` (loại phiếu + `seq`), tạo bản ghi. Mã: `HĐ-`, `TH-`, `TT-`, `PS-` + số `padStart(4,'0')`.

### 6.5 Sửa đơn và lịch sử
1. `PUT /orders/:id` phải gửi `version`. Khác `orders.version` hiện tại → `409 CONFLICT` ("Đơn đã bị sửa ở nơi khác, tải lại"). Thành công → `version + 1`.
2. Dựng đơn mới từ request (§6.3), so với đơn cũ bằng `diffOrders` đã port (khớp dòng/phí theo `id`; dòng/phí không có `id` = mới). Tên hàng/quy cách/khách lấy tại thời điểm sửa.
3. **Nếu `changes` rỗng → không ghi `order_edits`, không đổi `last_edit_at`** (D-22). Vẫn trả 200 với đơn hiện tại.
4. Có thay đổi → ghi `order_edits {edited_at, old_total, new_total, diff, changes: string[]}`, đặt `last_edit_at`.
5. Chuỗi trong `changes` phải **giống hệt** câu chữ `diffOrders` hiện tại (dùng `fmtMoney` kiểu `vi-VN`, `fmtQty` tối đa 2 số lẻ, `fmtDate dd/mm/yyyy`) — có test so khớp.

### 6.6 Hàng trả
Hai đường độc lập, đều giảm nợ: dòng `return` trong `orders` và phiếu `returns`. `purchased-returned` gộp cả hai (đúng `purchasedReturned`). Không chặn trả vượt.

### 6.7 Sao kê
- `POST statement-exports` chỉ ghi `{customerId, from, to, exportedAt}`.
- "Đơn đã điều chỉnh" = đơn của khách, chưa xóa, `last_edit_at > exportedAt` của **lần xuất gần nhất của khách đó** (không xét `from/to`). Không có lần xuất nào → danh sách rỗng.
- Với mỗi đơn đã điều chỉnh: `latestEditSinceExport` = bản `order_edits` mới nhất có `edited_at > exportedAt`.
- `totalDiff` = tổng `diff` của **mọi** `order_edits` có `edited_at > exportedAt` thuộc các đơn đó (đúng `StatementPage.jsx:59-69`).
- `purchaseTotals.range` = đơn trong `[from, to]`; `purchaseTotals.last12Months` = đơn trong `[to − 1 năm, to]` (D-24). Mỗi cái `{total, count}`.

### 6.8 Báo cáo — giữ đúng hiện trạng
- **Dashboard ngày/tháng và `act` theo ngày ở danh sách khách KHÔNG tính phát sinh (`adjustments`)** — đúng `dailyTotals`, `rangeTotals`, `dayActivitiesByCustomer`. Ghi rõ để không ai "sửa giúp". (Tổng nợ và dư nợ thì có tính.)
- `dailyTotals.orders` = tổng `orders.total` (đã trừ dòng trả trong đơn, đã gồm VAT, phí).
- `act.up` = tổng đơn trong ngày; `act.down` = tổng phiếu trả + tiền thu trong ngày.
- Xuất công nợ: theo D-23.

### 6.9 Xóa
Xóa mềm cho order/return/payment/adjustment/product/unit. Chỉ `orders` có `restore`.

### 6.10 Giới hạn giá trị
`qty`: > 0, ≤ 1.000.000, tối đa 3 chữ số thập phân (`|qty×1000 − round(qty×1000)| < 1e-6`). `price`: 0 … 1.000.000.000. Tiền thu/phát sinh: |x| ≤ 100.000.000.000. VAT %: 0 … 100, tối đa 2 chữ số thập phân. Ngày phải là ngày lịch hợp lệ. Tên khách bắt buộc. Đơn/phiếu trả phải có ít nhất 1 dòng hợp lệ.

---

## 7. Đặc tả API

### 7.1 Quy ước chung
- Tiền tố `/api`, JSON UTF-8, cùng origin với FE (production không CORS; dev qua proxy của Vite).
- Tiền: integer VND. `qty`: number. Ngày `YYYY-MM-DD`. Timestamp ISO UTC.
- Lỗi: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "lines[0].qty": "..." } } }`.
  Mã: `VALIDATION_ERROR 400`, `UNAUTHENTICATED 401`, `FORBIDDEN 403`, `NOT_FOUND 404`, `CONFLICT 409`, `RATE_LIMITED 429`, `INTERNAL 500`.
- Danh sách: `?limit=` (mặc định 30, tối đa 200) & `?offset=`; trả `{ items, total }` (+ `summary` khi ghi rõ).
- Mọi route trừ `GET /health` và `POST /auth/login` cần session.
- `requestId`: lấy từ `x-request-id` hoặc tự sinh; trả lại trong header; có trong mọi dòng log.

### 7.2 Danh sách endpoint

| Method | Path | Thay cho | Trang FE cần đối chiếu |
|---|---|---|---|
| POST | `/auth/login` | `store.login` | `LoginPage` |
| POST | `/auth/logout` | `store.logout` | |
| GET | `/auth/me` | — | |
| POST | `/auth/change-password` | `changePassword` | `SettingsPage` (min 4) |
| GET / PATCH | `/settings` | `settings` | `SettingsPage` |
| GET | `/customers` | `debtsByCustomer` + `dayActivitiesByCustomer` + lọc FE | `CustomersPage` |
| POST | `/customers` | `createCustomer` | |
| GET | `/customers/:id` | `balanceAt` | `CustomerDetailPage`, `PaymentsPage` |
| PATCH | `/customers/:id` | `updateCustomer` | |
| GET / POST | `/products`, `/units` | `createProduct/Unit` | `ProductsPage`, `ProductCombo` |
| PATCH / DELETE | `/products/:id`, `/units/:id` | update/delete (DELETE = xóa mềm) | |
| GET | `/customers/:id/prices` | `getPrice` (lấy cả bảng) | `PriceBookPage`, `OrderFormPage` |
| PUT | `/customers/:id/prices` | `setPrice` | |
| DELETE | `/prices/:id` | `removePrice` | |
| POST | `/customers/:id/prices/copy-from/:fromId` | `copyPriceBook` (thay toàn bộ bảng đích) | |
| GET | `/orders` | lọc FE | `OrdersPage` |
| POST | `/orders` | `createOrder` | `OrderFormPage` |
| GET | `/orders/:id` | + `balanceBeforeOrder` | `OrderDetailPage`, `OrderTicket` |
| PUT | `/orders/:id` | `updateOrder` | `OrderFormPage` |
| DELETE | `/orders/:id` | `deleteOrder` | |
| POST | `/orders/:id/restore` | `restoreOrder` | |
| GET / POST / DELETE | `/returns` | `createReturn/deleteReturn` | `ReturnsPage` |
| GET / POST / DELETE | `/payments` | `createPayment/deletePayment` | `PaymentsPage` |
| GET / POST / DELETE | `/adjustments` | `createAdjustment/deleteAdjustment` | `CustomerDetailPage` |
| GET | `/customers/:id/ledger` | `fullLedger` | `CustomerDetailPage` |
| GET | `/customers/:id/statement` | `ledgerRows + lastExportOf + ordersEditedAfter + purchaseTotal` | `StatementPage` |
| POST | `/customers/:id/statement-exports` | `recordStatementExport` | `StatementPage` |
| GET | `/customers/:id/purchased-returned` | `purchasedReturned` | `ReturnsPage`, `OrderFormPage` |
| GET | `/dashboard` | `totalDebtAt, dailyTotals, rangeTotals, debtSeries, debtsByCustomer` | `DashboardPage` |
| GET | `/reports/customer-debts` | `customerDebtRows` (FE tự tạo CSV) | `CustomersPage`, `SettingsPage` |
| GET | `/health` | — | |
| POST | `/client-log` | — | (FE gửi lỗi trình duyệt) |
| GET | `/system/update-status` | — | Phase 7, tùy chọn |

### 7.3 Dạng dữ liệu

**`GET /customers?q&sort=debt_desc|debt_asc&asOf&limit&offset`** (mặc định `sort=debt_desc`, `asOf` = hôm nay)
```json
{
  "items": [{"id":"c01","name":"Thanh Nhi","phone":"...","address":"...","note":"...",
             "openingDebt":{"amount":59356,"date":"2026-09-11"},
             "balance":71856, "act":{"up":12500,"down":0}}],
  "total": 15,
  "summary": {"totalDebt": 1234567}
}
```
`summary.totalDebt` = tổng dư nợ của **mọi** khách khớp `q` (không chỉ trang hiện tại). Sắp theo `balance` rồi `name` (FE dùng `localeCompare('vi')`; server dùng `name COLLATE NOCASE` — thứ tự hòa có thể khác nhẹ, chấp nhận).

**`GET /customers/:id?asOf`** → khách + `balance`.

**`POST /orders`** / **`PUT /orders/:id`**
```json
{
  "customerId": "c01",
  "date": "2026-10-11",
  "lines": [{"id": "chỉ có khi sửa dòng cũ", "type": "sell", "productId": "p1", "unitId": "u1", "qty": 20, "price": 500}],
  "vat": null,
  "fees": [{"id": "chỉ có khi sửa", "name": "Tiền ship", "amount": 25000}],
  "note": "",
  "version": 3
}
```
- `vat`: `null` = không VAT; `{"ratePercent": 8}` = tự tính; `{"amount": 10560, "ratePercent": 8}` = nhập tay.
- `version`: bắt buộc với `PUT`, bỏ qua với `POST`.
- Response: đơn đầy đủ `{id, code, customerId, date, seq, lines, vat:{ratePercent, amount, manual}|null, fees, note, total, version, createdAt, lastEditAt, deletedAt}`.
- FE hiện gửi `vat` (boolean), `vatRate`, `vatAmount` rời (`OrderFormPage.jsx:152-160`) → Phase 6 sửa đúng chỗ đó.

**`GET /orders?date&customerId&deleted&limit&offset`** → `{items, total, summary:{dayTotal}}`; mặc định loại đơn đã xóa, sắp `date DESC, seq`. `deleted=1` → chỉ đơn đã xóa, sắp theo lúc xóa mới nhất trước (để khôi phục đơn lỡ xóa).

**`GET /orders/:id`** → đơn + `balanceBefore`, `balanceAfter`, `editHistory:[{editedAt, oldTotal, newTotal, diff, changes:string[]}]`, kèm tên khách/hàng/quy cách để in phiếu.

**`GET /customers/:id/ledger?until&limit&offset`** → các dòng **mới nhất trước**, mỗi dòng `{date, seq, kind, desc, refId, code, up, down, balance}` với `balance` là dư lũy kế tính từ đầu (đúng `fullLedger`), + `total`. `until` mặc định hôm nay.

**`GET /customers/:id/statement?from&to`** (`from > to` → 400)
```json
{
  "opening": 0, "closing": 0,
  "rows": [{"date":"...","seq":1,"kind":"order","desc":"Đơn hàng HĐ-0001","refId":"o001","code":"HĐ-0001","up":12500,"down":0,"balance":71856}],
  "lastExport": {"exportedAt":"...","from":"...","to":"..."} ,
  "editedOrders": [{"id":"o010","code":"HĐ-0010","latestEditSinceExport":{"editedAt":"...","oldTotal":61500,"newTotal":67000,"diff":5500}}],
  "totalDiff": 5500,
  "purchaseTotals": {"range":{"total":0,"count":0}, "last12Months":{"total":0,"count":0}}
}
```

**`GET /dashboard?date`**
```json
{
  "date": "2026-10-11", "totalDebt": 0, "debtorCount": 0,
  "day":   {"orders":0,"orderCount":0,"payments":0,"paymentCount":0,"returns":0},
  "month": {"orders":0,"payments":0,"returns":0,"orderCount":0},
  "series": [{"date":"...","debt":0,"sales":0,"collected":0}],
  "topDebtors": [{"customerId":"c01","name":"...","phone":"...","balance":0}]
}
```
`month` = ngày 1 của tháng → `date`. `series` = 14 ngày kết thúc ở `date`. `topDebtors` = 5 khách nợ > 0 lớn nhất. `debtorCount` = số khách có dư nợ > 0 (FE cũ hiện `topDebtors.length`, tối đa 5 — sai; Phase 6 đổi sang `debtorCount`).

**`GET /reports/customer-debts?asOf`** → mảng `{customer:{id,name,phone}, opening, orders, returns, payments, adjust, end}` theo D-23.

**`GET /health`** → `{status:"ok"|"warning"|"error", version, schemaVersion, db:{ok}, lastBackup:{at,status}, warnings:[...]}`. `warning` khi quá 48h chưa có backup thành công.

**`POST /client-log`** → `{level, message, stack?, url, userAgent}`; tối đa 8 KB/request, 30 request/phút.

---

## 8. Cách tính phía SQL (hiệu năng)

- **Danh sách khách**: CTE `SELECT customer_id, SUM(delta) AS balance FROM ledger_events WHERE branch_id=? AND date<=? GROUP BY customer_id` + CTE `act` cho đúng ngày `asOf`, LEFT JOIN `customers`, lọc `search_text LIKE ?`, sắp/phân trang trong SQL; `summary.totalDebt` bằng một truy vấn tổng trên cùng điều kiện.
- **Biểu đồ 14 ngày**: một truy vấn `GROUP BY date` lấy delta từng ngày trong khoảng + một truy vấn nợ gốc trước ngày đầu, cộng dồn ở app (không lặp 14 lần như `debtSeries`).
- **Nợ cũ của đơn**: `SUM(delta)` cho đúng khách với điều kiện §6.2.
- **Sổ công nợ phân trang**: dư lũy kế bằng window function `SUM(delta) OVER (ORDER BY date, seq, rank)` rồi lấy trang mới nhất trước.
- Kiểm `EXPLAIN QUERY PLAN` để chắc điều kiện được đẩy vào từng nhánh `UNION ALL` của view và dùng index.
- **Ngưỡng**: 1.000 khách × 50.000 đơn (+ trả/thu/phát sinh tương ứng): `GET /customers` và `GET /dashboard` < 300ms trên máy dev. Chưa đạt mới tính tới cache.

---

## 9. Bảo mật

- **Mật khẩu**: `scrypt` N=2^15, r=8, p=1, salt 16 byte, **`maxmem: 64 * 1024 * 1024`** (mặc định 32 MiB của Node vừa sát nhu cầu 128·N·r, dễ lỗi). So sánh `timingSafeEqual`. Tham số lưu trong chuỗi hash để nâng sau. Tối thiểu 4 ký tự.
- **Session**: token ngẫu nhiên 32 byte, DB lưu **sha256**; cookie **`qlcn_sid`**, `httpOnly`, `SameSite=Lax`, `Path=/`; hạn 30 ngày, gia hạn khi dùng. (Cookie trên `localhost` không cô lập theo cổng — app khác trên máy có thể đọc; chấp nhận vì chỉ chạy local.)
- **Chống DNS rebinding**: hook toàn cục từ chối mọi request có `Host` không thuộc `{localhost:<port>, 127.0.0.1:<port>}`.
- **CSRF**: với mọi method ghi (POST/PUT/PATCH/DELETE): bắt buộc `Origin` **khớp chính xác** `http://localhost:<port>` hoặc `http://127.0.0.1:<port>` (gồm cổng — `SameSite` không phân biệt cổng); chỉ nhận `Content-Type: application/json`.
- **Khóa đăng nhập theo username** (mọi request đều từ 127.0.0.1): 5 lần sai → khóa 5 phút, tăng dần; ghi log (không ghi mật khẩu).
- **Bind `127.0.0.1`**.
- **Quyền tiến trình**: Windows chạy dưới `NT AUTHORITY\LocalService`; installer cấp quyền ghi thư mục dữ liệu bằng `icacls`. Thư mục app chỉ admin ghi được.
- **Mật khẩu admin ban đầu do khách đặt lúc cài**, truyền qua prompt/stdin, **không** qua tham số dòng lệnh. Không có mật khẩu mặc định.
- Mọi truy vấn qua `scope.ts`; mọi route qua `can()`.
- Log không chứa: mật khẩu, token, cookie, khóa cloud; số tiền và tên khách chỉ ghi `id`.

---

## 10. Vận hành

### 10.1 Cấu hình và đường dẫn
`config.json` trong thư mục dữ liệu (env override được): `port` (**chọn lúc cài, cố định** — D-30), `logLevel`, `backup.destinations[]`, `backup.localRetention`, `updates.manifestUrl`. Bí mật (token cloud) nằm trong file này, quyền đọc chỉ cho tài khoản dịch vụ + admin.

| OS | App | Dữ liệu |
|---|---|---|
| Windows | `%ProgramFiles%\QuanLyCongNo\app` | `%ProgramData%\QuanLyCongNo\{data,logs,backups,config.json}` |
| macOS | `~/Library/Application Support/QuanLyCongNo/app` | `~/Library/Application Support/QuanLyCongNo/{data,logs,backups,config.json}` |

### 10.2 CLI (`main.ts`)
`serve` · `supervise` · `migrate` · `init-admin` · `backup` · `restore <file|date>` · `doctor` · `version`. Installer, updater và người hỗ trợ chỉ dùng các lệnh này.

### 10.3 Log
- `pino` + `pino-roll`, JSON mỗi dòng: `time, level, component, requestId, msg, err`. Xoay theo ngày, giữ 14 ngày.
- Tệp: `app.log` (server + supervisor), `backup.log`, `install-<ts>.log`, `update-<ts>.log`.
- Supervisor ghi: mỗi lần khởi động/crash/chạy lại, mã thoát, số lần chạy lại liên tiếp.
- Installer: `Start-Transcript` (PowerShell) / `tee` (sh). Updater ghi từng bước kèm thời gian, kết quả, rollback.
- FE gửi lỗi trình duyệt (`window.onerror`, `unhandledrejection`) qua `POST /client-log` → `app.log` với `component: "web"`.
- **`doctor`**: in ra màn hình và ghi một file `.json.gz` gồm: phiên bản, OS, cấu hình đã che bí mật, `PRAGMA integrity_check`, `backup_runs` gần nhất, trạng thái task/launchd, 7 ngày log. **Không** có dữ liệu nghiệp vụ (có test kiểm). Khách gửi file này cho Finn qua Zalo.

### 10.4 Health
`GET /health` (§7.3). Updater dùng làm health check sau cập nhật; FE dùng để hiện cảnh báo backup.

### 10.5 Backup
- **Cách chụp**: `VACUUM INTO` → file `.db` nhất quán → `gzip` → `backups/` → upload các đích cloud.
- **Khi nào chạy** (D-28): (a) 5 phút sau khi server khởi động, nếu bản thành công gần nhất cũ hơn 24h; (b) mỗi 6h nếu có ghi dữ liệu kể từ bản gần nhất; (c) trước mọi lần cập nhật/restore; (d) thủ công qua `backup`.
- **Giữ local**: 7 bản định kỳ gần nhất + 3 bản `pre-update`/`pre-restore` gần nhất.
- **Đích**: `folder` (gồm USB/ổ mạng) và `s3` (R2/B2/S3). Google Drive để sau nếu khách yêu cầu.
- **R2** (D-27): mỗi shop một bucket, token chỉ quyền Object Read & Write trên bucket đó (kiểm lại tài liệu R2 hiện hành khi làm). Retention cloud (30 bản ngày + 12 bản tháng) bằng **lifecycle rule** của bucket, app không tự xóa trên cloud.
- **Không mã hóa phía client** (D-21). Finn báo khách biết backup nằm trong tài khoản cloud của Finn.
- **Mất mạng**: bản local vẫn tạo; upload lỗi ghi `backup_runs` + `backup.log`, lần sau thử lại bản mới nhất.
- **Cảnh báo**: quá 48h chưa có bản thành công → `/health` = `warning`.
- **Restore** (`restore <file|date>`, chạy với quyền admin): dừng task → `integrity_check` bản backup → chụp DB hiện tại thành `pre-restore-<ts>.db` → thay thế → khởi động → chờ `/health`. Thất bại → trả DB cũ.

---

## 11. Đóng gói, cài đặt, cập nhật

### 11.1 Gói phát hành
Mỗi target một file `qlcn-<version>-<os>-<arch>.zip`: `runtime/` (Node), `server/` (đã build + `node_modules` production), `web/` (FE build), `version.json`. Target: **win-x64, darwin-arm64, darwin-x64**. Build trên CI theo từng OS, `npm ci` bằng **chính binary Node được bundle**. Khi khởi động, server nạp `better-sqlite3` sớm; lỗi ABI → log rõ ràng và thoát mã riêng.

`manifest.json`: `{ version, releasedAt, minInstallerVersion, notes, files: { "win-x64": {url, sha256, size}, ... } }` + `manifest.sig` (ed25519). Installer và app nhúng **2 public key**; chữ ký hợp lệ với một trong hai là được. Private key chỉ Finn giữ, có bản dự phòng offline.

### 11.2 Cài đặt (1 lệnh)
```
Windows (PowerShell chạy Admin):  irm https://<host>/install.ps1 | iex
macOS:                            curl -fsSL https://<host>/install.sh | sh
```
1. Phát hiện OS/arch; tải `manifest.json` + `.sig`, kiểm chữ ký.
2. Tải gói, kiểm `sha256`.
3. Giải nén vào thư mục app; tạo thư mục dữ liệu; (Windows) cấp quyền `LocalService`.
4. Chọn cổng (mặc định cố định, ví dụ 8686; bận thì hỏi cổng khác) → ghi `config.json`.
5. Hỏi tên đăng nhập + mật khẩu admin → `init-admin` qua stdin.
6. `migrate`.
7. Đăng ký chạy nền (§11.4), khởi động.
8. Chờ `/health` OK (tối đa 30s), mở trình duyệt `http://localhost:<port>`.

Chạy lại khi đã cài: **idempotent** — không ghi đè dữ liệu, không hỏi lại mật khẩu, không đổi cổng; nếu có bản mới thì chuyển sang luồng cập nhật.

### 11.3 Cập nhật (cùng lệnh cài, hoặc `update`; cần quyền admin — D-29)
1. Tải manifest + chữ ký, so phiên bản; không có bản mới → dừng.
2. Tải gói, kiểm `sha256`.
3. **Backup DB** (`trigger = pre-update`).
4. Dừng task/agent → đổi tên `app` → `app.prev` → giải nén bản mới vào `app`.
5. `migrate` (chỉ tiến).
6. Khởi động → chờ `/health` OK.
7. **Lỗi ở bước 4–6**: dừng, trả `app.prev` về `app`, khôi phục DB từ bản pre-update, khởi động lại, ghi log nguyên nhân, thoát mã lỗi.
8. Thành công: giữ `app.prev` (1 bản) để rollback tay, xóa bản cũ hơn.

App **từ chối khởi động** nếu `schemaVersion` của DB mới hơn code (chặn hạ cấp nhầm).

### 11.4 Chạy nền
**Supervisor** (`main.ts supervise`): spawn `serve`, nếu tiến trình con thoát bất thường thì chạy lại với backoff (1s, 2s, 5s, 10s, tối đa 60s); quá 10 lần/5 phút → dừng chạy lại, ghi log `error`. Dùng chung cho Windows và Mac.

**Windows — Task Scheduler** (`task-windows.xml`, đăng ký bằng `schtasks /Create /XML`):
- Trigger: khi khởi động máy (`BootTrigger`).
- Principal: `NT AUTHORITY\LocalService`.
- `ExecutionTimeLimit = PT0S` (mặc định task bị **giết sau 3 ngày**).
- `DisallowStartIfOnBatteries = false`, `StopIfGoingOnBatteries = false` (mặc định laptop chạy pin sẽ không chạy/tự dừng).
- `MultipleInstancesPolicy = IgnoreNew`; `Hidden = true`.
- Không dựa vào "Restart on failure" của Task Scheduler để xử lý crash — supervisor lo.
- Nếu Phase 0b chứng minh Task Scheduler không đạt trên VM sạch → dừng lại hỏi Finn (phương án dự phòng: Windows Service wrapper).

**macOS — launchd**: `~/Library/LaunchAgents/<id>.plist`, `RunAtLoad = true`, `KeepAlive = true`, chạy `supervise`. Không cần sudo.

### 11.5 CI/CD
GitHub Actions: tag `v*` → matrix 3 target → `sha256` → `sign-manifest` (private key từ GitHub Secret) → đẩy artifact + manifest lên nơi phát hành. **[CHƯA BIẾT]** nơi phát hành (bucket R2 công khai riêng hoặc GitHub Releases repo riêng).

---

## 12. Kế hoạch triển khai theo phase

Quy tắc: mỗi phase kết thúc phải **chạy được và có test**. Chưa đạt nghiệm thu thì không sang phase sau.

### Phase 0a — Khung server
- `server/` với Fastify, config, log (`pino-roll`), hook Host/Origin, `/health`, mở SQLite + PRAGMA, trình migration (checksum, transaction), migration thử.
- CLI: `serve`, `supervise`, `migrate`, `version`.
- **Nghiệm thu**: chạy được bằng `tsx`; test migration (áp dụng, bỏ qua bản đã chạy, từ chối file đã sửa); test hook Host/Origin; supervisor chạy lại khi giết tiến trình con và ghi log.

### Phase 0b — Thử đóng gói ("hello release") — rủi ro cao nhất
- `build-release`, `sign-manifest`, `install.ps1`/`install.sh` tối thiểu, đăng ký Task Scheduler/launchd, `update` tối thiểu có rollback, CI matrix.
- **Nghiệm thu** trên **VM sạch** Windows và macOS:
  1. Một lệnh cài xong, `/health` OK, trình duyệt mở đúng trang.
  2. Khởi động lại máy vẫn tự chạy; laptop rút sạc vẫn chạy.
  3. Giết tiến trình → supervisor chạy lại.
  4. Phát hành `v0.0.2` → cập nhật bằng 1 lệnh thành công.
  5. Phát hành `v0.0.3` cố tình hỏng → tự rollback, dữ liệu nguyên vẹn.
  6. Manifest sai chữ ký → từ chối cài.
  7. Có đủ `install-*.log`, `update-*.log`.
- Xác nhận prebuilt `better-sqlite3` cho Node 22 trên cả 3 target.

### Phase 1 — Lõi miền + differential (chưa có DB)
- `shared/money.ts`, `shared/dates.ts`, `shared/text.ts`, `modules/ledger` (port `debt.js` + `diffOrders` sang TS, hàm thuần).
- Port 26 test `debt.test.js` + `seed.test.js` (kỳ vọng nguyên văn).
- **Bộ differential**: sinh dữ liệu ngẫu nhiên có seed cố định (đơn cùng ngày, sửa đổi ngày, dòng trả, VAT tự/nhập tay, phí, số lượng thập phân, nợ đầu kỳ sau `asOf`, xóa mềm), so từng kết quả của bản TS với `src/lib/debt.js` gốc. Ghi rõ chỗ khác **có chủ đích** (D-23, D-24) và mọi lệch VAT 1 VND.
- **Nghiệm thu**: 26 test pass; differential pass; test `lineAmount` (số lẻ, số lớn), VAT, chuỗi `diffOrders` giống hệt bản gốc.

### Phase 2 — Auth, danh mục, khách, bảng giá
- Migration `0001`; seed chi nhánh mặc định + settings mặc định; auth (login/logout/me/change-password, khóa theo username), settings, customers (`search_text`), products/units (xóa mềm), price book (upsert, copy, ẩn hàng đã xóa).
- CLI `init-admin`.
- **Nghiệm thu**: test `fastify.inject` mỗi route (happy path + validation + chưa đăng nhập + Origin sai); tìm khách không dấu theo tên và SĐT; copy bảng giá thay đúng; khóa đăng nhập hoạt động.

### Phase 3 — Phát sinh nghiệp vụ
- Orders (create/update có `version`/delete/restore + lịch sử chuỗi), returns, payments, adjustments; sinh mã + `seq` trong transaction.
- **Nghiệm thu**: tổng đơn/VAT/phí đúng (VAT nhập tay, dòng trả, tổng âm); sửa không đổi gì → không có `order_edits` (D-22); sửa có đổi → chuỗi đúng; `version` lệch → 409; 50 request tạo đơn song song → mã không trùng; xóa mềm/khôi phục đúng.

### Phase 4 — API đọc + đối chiếu
- `customers` (balance, act, summary), `customers/:id`, `orders/:id` (nợ cũ/mới), `ledger` (phân trang), `statement`, `dashboard`, `reports/customer-debts`, `purchased-returned`.
- Dùng lại bộ differential của Phase 1: nạp dữ liệu qua API rồi so số liệu API với `debt.js`.
- **Nghiệm thu**: differential pass (trừ chỗ cố ý khác); benchmark §8 đạt; `EXPLAIN QUERY PLAN` dùng index; đã mở từng trang FE ở §7.2 để đối chiếu dạng response.

### Phase 5 — Vận hành
- Backup (`VACUUM INTO`, các trigger D-28, giữ local), đích `folder` + `s3`, `restore`, `doctor`, `POST /client-log`, cảnh báo backup trong `/health`.
- **Nghiệm thu**: backup → restore sang máy/thư mục khác → số liệu khớp; ngắt mạng vẫn có bản local và lần sau đẩy lên; lỗi upload ghi đủ log; file `doctor` không chứa dữ liệu nghiệp vụ (test); restore hỏng → DB cũ nguyên vẹn.

### Phase 6a — Nối FE: hạ tầng + màn chỉ đọc
- `src/api/httpApi.js`; cờ `VITE_API_MODE=mock|http`; proxy `/api` trong `vite.config.js`; store async + mẫu loading/lỗi dùng chung; đăng nhập thật; gửi lỗi trình duyệt về `/client-log`.
- Chuyển: Tổng quan (dùng `debtorCount`), Khách hàng, Chi tiết khách, Danh sách đơn, Chi tiết đơn/phiếu, Sao kê (xem).

### Phase 6b — Nối FE: luồng ghi
- Khách, sản phẩm/quy cách, bảng giá, lập/sửa đơn (gửi `vat` object + `version`, xử lý 409), hàng trả, thu tiền, phát sinh, ghi nhận xuất sao kê, cài đặt.

### Phase 6c — Dọn FE
- Bỏ persist `localStorage` cho dữ liệu nghiệp vụ (giữ `orderDraft`); bỏ "Nạp lại dữ liệu mẫu" và nút xuất JSON; bỏ mật khẩu trong store.
- **Nghiệm thu 6a–6c**: chạy trọn kịch bản nghiệm thu trong README bằng app thật ở cả 3 breakpoint (375/768/1280); test FE hiện có vẫn pass.

### Phase 7 — Hoàn thiện và thí điểm
- (Tùy chọn) dải báo "Có bản mới — chạy lệnh cập nhật" dựa trên `GET /system/update-status`.
- Tài liệu cài đặt cho khách + hướng dẫn xử lý sự cố.
- Cài ở một máy khách thật, theo dõi 1–2 tuần.

---

## 13. Chiến lược test

- **Đơn vị**: `money`, `dates`, `text`, `ledger`, `diffOrders`.
- **API**: `fastify.inject` + SQLite in-memory chạy migration thật; mỗi route: happy path + 1–2 edge (validation, quyền, Origin, xóa mềm).
- **Differential**: so với `src/lib/debt.js` (Phase 1 ở mức hàm, Phase 4 ở mức API) — lưới an toàn chính cho công nợ.
- **Đồng thời**: sinh mã khi nhiều request song song; `version` khi 2 lần sửa chồng nhau.
- **Đóng gói**: checklist thủ công trên VM sạch (cài, khởi động lại, rút sạc, crash, cập nhật, rollback, restore, chữ ký sai) — chạy lại mỗi lần đổi installer/updater/task.
- Ưu tiên phần dễ vỡ: validation, dòng tiền, schema.

---

## 14. Rủi ro và việc chưa biết

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R1 | Đóng gói trên Windows sạch (antivirus, quyền, đường dẫn Unicode) | Phase 0b làm sớm, VM sạch |
| R2 | Không có prebuilt `better-sqlite3` cho Node/arch cần | Kiểm ở 0b; dự phòng: build từ nguồn trên CI |
| R3 | Lệch 1 VND giữa FE (float) và server (số nguyên) | 8% luôn trùng; differential test; số server là chuẩn |
| R4 | FE chuyển sang async ảnh hưởng nhiều trang | Phase 6a/6b/6c, cờ `mock|http` |
| R5 | Backup không mã hóa nằm trong tài khoản cloud của Finn | Token theo bucket; báo khách rõ |
| R6 | Cập nhật hỏng giữa chừng | Backup pre-update + rollback + chặn hạ cấp schema |
| R7 | Mất điện giữa lúc ghi | WAL + `synchronous=FULL` + `integrity_check` khi khởi động |
| R8 | Máy khách là điểm lỗi duy nhất | Backup cloud theo sự kiện + cảnh báo quá hạn |
| R9 | Chưa biết Windows hay macOS | Build và thử cả hai |
| R10 | Cấu hình mặc định của Task Scheduler (3 ngày, pin) | §11.4 cấu hình tường minh + nghiệm thu 0b |
| R11 | Mất private key ký cập nhật | 2 public key nhúng sẵn; key dự phòng offline |
| R12 | Chưa biết quy mô thật | Benchmark Phase 4; index đã đủ dư địa |
| R13 | Trang web độc gọi vào `localhost` | Allowlist `Host` + `Origin` chính xác + chỉ JSON |
| R14 | Node 22 hết hỗ trợ 30/04/2027 | Trước mốc đó: đổi runtime bundle sang LTS mới, chạy lại test + checklist VM, phát hành như bản cập nhật thường (khách chạy lệnh cập nhật). Không viết code phụ thuộc tính năng chỉ có ở Node 22 |

**[CHƯA BIẾT] — không chặn việc code:**
- Khách dùng Windows hay macOS; ai cài/cập nhật cho khách.
- Ai tạo và trả phí tài khoản cloud (R2); nơi đặt file phát hành/manifest.

---

## 15. Quy ước cho người triển khai (theo hướng dẫn cá nhân của Finn)

- **Code (biến, hàm, comment) viết bằng tiếng Anh.** Trao đổi với Finn bằng tiếng Việt.
- Dễ hiểu > ngắn gọn. Tên mô tả đúng ý. Comment giải thích **tại sao**, không lặp điều code đã nói.
- Rule of three: chỉ tách hàm/module dùng chung từ lần lặp thứ 3. Không over-engineer.
- **Hỏi trước khi**: thêm/đổi dependency (kể cả các gói ở §3), đổi cấu trúc thư mục, đổi kiến trúc, làm khác bất kỳ quyết định nào ở §2.
- Mỗi feature mới có test: happy path + 1–2 edge case.
- Trước khi coi là xong: không `console.log`, không dead code, không lỗi lint/type.
- Không commit secret/API key/private key; dùng `.env` hoặc file cấu hình ngoài git.
- **Chỉ commit khi Finn yêu cầu.** Conventional Commits, subject 1 dòng ~50–72 ký tự. **Không** thêm trailer `Co-Authored-By: Claude ...`.
- Không chạy job nặng song song (build nhiều target, benchmark, VM): chạy tuần tự.
- TypeScript `strict`; validate mọi input bằng zod ở biên; không `any` ở API.
- Phase 6 (FE): mọi phần tử bấm được có trạng thái `:active`; kiểm 3 breakpoint 375/768/1280.

---

## 16. Lịch sử review

**2026-10-11 — Review (Opus), Finn chốt toàn bộ.** Thay đổi so với bản đề xuất:
- Bổ sung hợp đồng theo UI thật: `act` + `summary.totalDebt` (Khách hàng), `debtorCount` (Tổng quan), `latestEditSinceExport` + `totalDiff` (Sao kê), sổ công nợ phân trang, cột `note` trong `ledger_events`.
- Nghiệp vụ: D-22 (không ghi lịch sử khi không đổi), D-23 (sửa CSV công nợ), D-24 (12 tháng), D-25 (`version`), D-26 (lịch sử dạng chuỗi thay vì JSON có cấu trúc), D-32 (DB trắng).
- Vận hành: D-27 (bucket theo shop + lifecycle), D-28 (backup theo sự kiện), D-29 (`LocalService`, cập nhật chỉ qua lệnh admin), D-30 (cổng cố định), D-33 (Host/Origin/cookie/khóa theo username), D-34 (`pino-roll`, `doctor` qua CLI).
- Task Scheduler: cấu hình tường minh + supervisor riêng.
- `scrypt` `maxmem` 64 MiB; 2 public key ký cập nhật; không port lỗi `|| 9`.
- Phase: tách 0a/0b và 6a/6b/6c; differential test lên Phase 1.
- Cắt phạm vi: sắp xếp theo tên, API backup/chẩn đoán qua web, nút cập nhật trên UI.

**2026-10-11 — Finn chốt dùng Node 22 LTS** thay vì 24 (khớp máy dev, không cài thêm); chấp nhận phải nâng runtime trước 30/04/2027 (R14).
