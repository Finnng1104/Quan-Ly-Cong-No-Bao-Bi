# Tình trạng dự án và việc tồn đọng

Cập nhật: 2026-10-13 · Branch: `feat/backend` (chưa push, chưa merge vào `main`)

Tài liệu thiết kế đầy đủ: `server/PLAN.md`. Cách phát hành bản cài: `server/packaging/README.md`.

## 1. Tóm tắt

| Hạng mục | Trạng thái |
|---|---|
| Backend (Node + Fastify + SQLite) | Xong, 735 test pass |
| Nối giao diện với backend | Xong, đã bấm thử các luồng chính trên trình duyệt |
| Đối chiếu công nợ với bản gốc (`debt.js`) | Xong, dữ liệu ngẫu nhiên khớp từng con số |
| Backup / khôi phục / chẩn đoán / log | Xong; **chưa thử với R2 thật** |
| Cài đặt + cập nhật + quay lại bản cũ — macOS | Xong, đã thử thật |
| Cài đặt + cập nhật — Windows | **Đã viết, chưa chạy trên Windows thật** |
| Thí điểm tại khách (Phase 7) | Chưa làm |

**Có thể dùng thử nội bộ ngay. Chưa nên giao cho khách dùng thật** trước khi chạy `install.ps1` trên một máy
Windows sạch (nếu khách dùng Windows) và thí điểm 1–2 tuần — đây là sổ nợ thật của họ.

## 2. Đã làm (theo commit)

| Commit | Nội dung | Phase |
|---|---|---|
| `docs(server): add backend plan` | Kế hoạch backend đã review và chốt (D-01…D-34) | — |
| `chore(server): scaffold backend package` | package.json, TypeScript, Vitest, `.nvmrc` (Node 22) | 0a |
| `feat(server): add debt ledger core…` | Tiền (số nguyên, BigInt), ngày, tìm kiếm không dấu, port `debt.js` + `diffOrders`, test đối chiếu ngẫu nhiên | 1 |
| `feat(server): add config, SQLite, migrations…` | Cấu hình, SQLite (WAL, `synchronous=FULL`), migration có checksum, log (pino), hash mật khẩu, validate | 0a |
| `feat(server): add backup, restore, diagnostics…` | Backup local/thư mục/S3-R2, restore, file chẩn đoán, ký SigV4 (khớp ví dụ AWS) | 5 |
| `feat(server): add HTTP API, auth and business modules` | Đăng nhập (khóa theo username), khách, sản phẩm, bảng giá, đơn/trả/thu/phát sinh, sổ công nợ, sao kê, tổng quan, supervisor, CLI | 0a, 2, 3, 4 |
| `feat(server): add packaging, installer…` | Build gói, ký manifest (ECDSA P-256), `install.sh`, `install.ps1`, workflow CI | 0b |
| `feat(web): connect screens to the local backend` | 13 màn hình gọi API thật; sửa các lỗi giao diện tìm được khi bấm thử | 6 |
| `docs: add status and handover notes` | File này | — |

### Lỗi có sẵn của bản gốc đã sửa khi nối giao diện
- Chọn khách ở 4 trang (Thu tiền, Hàng trả, Bảng giá, Sao kê) lưu cả đối tượng khách thay vì id.
- Nút xuất CSV ở trang Khách dùng biến `toast` chưa khai báo.
- Ô số lượng nhập "1,5" bị coi là 0 (dòng bị bỏ im lặng).
- "N khách còn nợ" chỉ đếm tối đa 5 (đếm theo danh sách top 5).
- Cửa sổ "hàng lấy 12 tháng" ở sao kê lệch 1 ngày do múi giờ.
- Ô thêm sản phẩm/quy cách không xóa ngay, gõ tiếp bị nối vào tên cũ.

### Khác với plan gốc (đã ghi trong `server/PLAN.md`)
- Chữ ký manifest dùng **ECDSA P-256**, không phải ed25519 (installer phải kiểm được trước khi chạy gì).
- Bỏ cờ `VITE_API_MODE=mock|http`: giao diện chuyển thẳng sang HTTP.
- Gói phát hành là `.tar.gz` cho cả 3 nền tảng.
- DB hỏng (`quick_check` lỗi) thì server **không khởi động** (mã thoát riêng).
- Tổng đơn của server có thể lệch 1 VND so với bản gốc ở ~1/2.000 mẫu (bản gốc dùng số thực); số của server là đúng.

## 3. Việc tồn đọng

### A. Cần bạn cung cấp / quyết định (mai làm)
| # | Việc | Dùng cho |
|---|---|---|
| ~~A1~~ | ~~Tạo khóa ký~~ — **xong 2026-10-12**: private key ở `~/qlcn-signing-keys/` (máy Finn, cần cất offline), public key đã commit | Phát hành |
| A2 | Chọn nơi đặt file phát hành (bucket R2 công khai riêng hoặc GitHub Releases của repo riêng) + domain | Link cài đặt khách chạy |
| A3 | Repo GitHub **riêng của Finn** (Finn không có quyền repo `LofizDev`) + secret `QLCN_SIGNING_KEY` + biến `QLCN_RELEASE_BASE_URL`. Khách dùng Mac chip M thì build tay trên máy Finn được, không cần CI | CI build Windows / Mac Intel |
| A4 | Tài khoản R2: endpoint, bucket **mỗi shop một bucket**, token chỉ quyền trên bucket đó | Backup cloud |
| A5 | Khách dùng Windows hay macOS, ai cài/cập nhật, cổng mong muốn (mặc định 8686) | Chọn việc ưu tiên |
| A6 | Tên đăng nhập chủ shop và tên cửa hàng | Cài đặt |

### B. Cần kiểm chứng thật (mình chưa làm được)
| # | Việc | Ghi chú |
|---|---|---|
| B1 | Chạy `install.ps1` và `qlcn.ps1` trên Windows sạch (VM): cài, cập nhật, quay lại bản cũ, `qlcn restore` | **Rủi ro lớn nhất**; kiểm Task Scheduler + `LocalService` + antivirus |
| B2 | Tắt/bật lại máy, rút sạc laptop: dịch vụ có tự chạy lại không | Yêu cầu "chạy ổn định" |
| B3 | Backup lên R2 thật rồi khôi phục từ file đó | Mới chứng minh chữ ký đúng |
| B4 | Build + thử trên Mac Intel (x64) và chạy workflow CI | Chưa chạy lần nào |
| B5 | In / PDF / lưu ảnh phiếu A5, A4 | Mình tránh hộp thoại in nên chưa xem kết quả |
| B6 | Thí điểm 1–2 tuần tại máy khách thật (Phase 7) | Thường lòi lỗi mà test không thấy |

### C. Chưa làm
| # | Việc |
|---|---|
| C1 | Hướng dẫn sử dụng cho chủ shop (cài, đăng nhập, backup, khi lỗi làm gì) — có skill `client-howto-guide` |
| ~~C2~~ | ~~Lệnh `qlcn`~~ — **xong**: status/start/stop/backup/backups/restore/doctor/logs, đã thử thật trên macOS; bản Windows chưa chạy thật |
| C3 | Dải "có bản mới" trong giao diện + `/api/system/update-status` (app chưa kiểm chữ ký, chỉ installer kiểm) |
| C4 | Nút khôi phục backup trong Cài đặt — **PLAN đã chốt không làm** ("API backup/chẩn đoán qua web: dùng CLI"); chỉ làm nếu Finn đổi quyết định |
| ~~C5~~ | ~~Xuất sao kê PDF/Excel thật~~ — **xong** (F3 bên dưới) |
| C6 | Test tự động cho giao diện (hiện chỉ test logic + bấm tay) |

### D. Nợ kỹ thuật nhỏ
- 1 cảnh báo lint (`Toast.jsx` export cả hook lẫn component; chỉ ảnh hưởng hot-reload lúc dev); web bundle 760 kB (chưa tách chunk).
- Tên file log của `pino-roll` có số lạ (`app.2026-10-12.3612.log`), chỉ là cosmetic.
- `src/api/mockApi.js`, `src/data/mockData.js`, `src/lib/debt.js` không còn được app dùng; **giữ lại** vì test của
  `server/` dùng làm bản đối chiếu. Đừng xóa hay sửa công thức trong đó.
- Giao diện cần backend đang chạy; mất server thì app báo lỗi kết nối (không còn dùng offline như bản demo).

## 4. Bàn giao cho khách cần gì (khi A1–A4 xong)
1. Lệnh cài: `curl -fsSL <BASE_URL>/install.sh | bash` (macOS) hoặc `irm <BASE_URL>/install.ps1 | iex` (Windows, Admin).
2. Tên đăng nhập + mật khẩu do chính khách đặt lúc cài (không có mật khẩu mặc định).
3. Cách gửi file chẩn đoán khi lỗi, và cách khôi phục từ backup (cần C1/C2).
4. Cho khách biết: dữ liệu nằm trên máy họ; backup cloud nằm trong tài khoản R2 của bạn (không mã hóa phía client).

## 5. Sửa giao diện 2026-10-13 (Finn đồng ý cho sửa `src/`)

| # | Việc | Cách làm |
|---|---|---|
| F1 | Dải vàng cảnh báo sao lưu ở đầu mọi trang | `HealthBanner` gọi `GET /api/health` khi mở app và mỗi 30 phút; 503 → "không đọc được dữ liệu" |
| F2 | Trang Đơn hàng có nút lọc **Đơn đã xóa** (`?deleted=1`) | Hiện giờ xóa; bấm vào đơn → **Khôi phục** đã có sẵn. Ẩn thẻ "Tổng đơn hôm nay" khi xem đơn xóa |
| F3 | Sao kê **Xuất Excel** = file CSV (mở bằng Excel), **Xuất PDF** = hộp thoại in với bảng sao kê gọn | Tên file `sao-ke-<khach-khong-dau>-<từ>-<đến>`; chỉ ghi nhận "lần xuất" sau khi đã tạo file |
| F4 | Sửa chữ hộp thoại PDF ở chi tiết đơn | — |

Sửa thêm khi kiểm tra:
- In ra **trang trắng thừa** khi trang dài (sao kê; đơn nhiều dòng): vùng in giờ nằm thẳng trong `<body>` (portal), lúc in mọi thứ khác bị `display: none`.
- Sao kê ghi "Từ sao kê ngày 12/10" cho lần xuất lúc 00:11 ngày 13/10 (cắt chuỗi giờ UTC) — giờ đổi theo giờ máy.
- Xóa `SearchInput` (không dùng) và export thừa `avatarColors`.

Đã kiểm bằng trình duyệt tự động (Playwright) trên server thử: 13 màn hình × 375/768/1280 không lỗi console, không
tràn ngang; luồng xóa → xem đơn đã xóa → khôi phục; tải CSV; PDF sao kê 1 trang; phiếu đơn vẫn in 1 trang.
**Chưa** in ra máy in thật (B5).

## 6. Đưa lên mạng cho khách thử (Vercel + Railway) — code xong, chưa deploy

Finn chọn deploy cả FE và BE. Cách làm từng bước: **`DEPLOY.md`**.

- Backend có chế độ online, **chỉ bật khi có `QLCN_PUBLIC_URLS`** (D-35 trong `server/PLAN.md`): nghe `0.0.0.0`,
  cổng theo `PORT`, cho phép các địa chỉ đó qua kiểm tra Host/Origin, cookie `Secure`, tạo tài khoản đầu từ
  `QLCN_ADMIN_USERNAME`/`QLCN_ADMIN_PASSWORD`. Bản cài local không đổi.
- `server/Dockerfile`: đã build và chạy thử (linux/amd64) — đăng nhập qua Origin giả lập Vercel được, Origin lạ bị
  chặn, dữ liệu còn sau khi khởi động lại, tài khoản chỉ tạo 1 lần.
- `vercel.json`: chuyển `/api/*` sang backend — **phải thay `SET-BACKEND-URL.invalid`** bằng địa chỉ backend thật.
- **Chưa kiểm chứng** trên Vercel/Railway thật (cần tài khoản của Finn): nhất là Vercel có chuyển header `Origin`
  sang backend không — nếu mọi thao tác lưu báo "Nguồn yêu cầu không hợp lệ" thì báo lại.

## 7. Lệnh hay dùng
```bash
# kiểm tra
cd server && npx tsc --noEmit && npm test     # 735 test
cd .. && npm test && npm run lint && npm run build

# chạy phát triển: xem README.md (backend rồi web)

# đóng gói / phát hành: xem server/packaging/README.md
```
