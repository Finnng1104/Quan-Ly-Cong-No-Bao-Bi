# Tình trạng dự án và việc tồn đọng

Cập nhật: 2026-10-12 · Branch: `feat/backend` (chưa push, chưa merge vào `main`)

Tài liệu thiết kế đầy đủ: `server/PLAN.md`. Cách phát hành bản cài: `server/packaging/README.md`.

## 1. Tóm tắt

| Hạng mục | Trạng thái |
|---|---|
| Backend (Node + Fastify + SQLite) | Xong, 727 test pass |
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
| A1 | Tạo khóa ký: `node server/packaging/manifest.mjs keygen main` và `keygen backup`; giữ private key ngoài repo, commit 2 file `*.public.pem` vào `server/packaging/public-keys/` | Phát hành |
| A2 | Chọn nơi đặt file phát hành (bucket R2 công khai riêng hoặc GitHub Releases của repo riêng) + domain | Link cài đặt khách chạy |
| A3 | Repo GitHub + secret `QLCN_SIGNING_KEY` + biến `QLCN_RELEASE_BASE_URL` | CI build 3 nền tảng |
| A4 | Tài khoản R2: endpoint, bucket **mỗi shop một bucket**, token chỉ quyền trên bucket đó | Backup cloud |
| A5 | Khách dùng Windows hay macOS, ai cài/cập nhật, cổng mong muốn (mặc định 8686) | Chọn việc ưu tiên |
| A6 | Tên đăng nhập chủ shop và tên cửa hàng | Cài đặt |

### B. Cần kiểm chứng thật (mình chưa làm được)
| # | Việc | Ghi chú |
|---|---|---|
| B1 | Chạy `install.ps1` trên Windows sạch (VM): cài, cập nhật, quay lại bản cũ | **Rủi ro lớn nhất**; kiểm Task Scheduler + `LocalService` + antivirus |
| B2 | Tắt/bật lại máy, rút sạc laptop: dịch vụ có tự chạy lại không | Yêu cầu "chạy ổn định" |
| B3 | Backup lên R2 thật rồi khôi phục từ file đó | Mới chứng minh chữ ký đúng |
| B4 | Build + thử trên Mac Intel (x64) và chạy workflow CI | Chưa chạy lần nào |
| B5 | In / PDF / lưu ảnh phiếu A5, A4 | Mình tránh hộp thoại in nên chưa xem kết quả |
| B6 | Thí điểm 1–2 tuần tại máy khách thật (Phase 7) | Thường lòi lỗi mà test không thấy |

### C. Chưa làm
| # | Việc |
|---|---|
| C1 | Hướng dẫn sử dụng cho chủ shop (cài, đăng nhập, backup, khi lỗi làm gì) — có skill `client-howto-guide` |
| C2 | Lệnh ngắn cho chẩn đoán/khôi phục (hiện phải gọi `node main.js doctor/restore ...`); nên có wrapper `qlcn` |
| C3 | Dải "có bản mới" trong giao diện + `/api/system/update-status` (app chưa kiểm chữ ký, chỉ installer kiểm) |
| C4 | Nút khôi phục backup trong Cài đặt (hiện chỉ CLI) |
| C5 | Xuất sao kê PDF/Excel thật — hiện chỉ ghi nhận lần xuất (đúng phạm vi D-01, nhưng khách có thể mong có file) |
| C6 | Test tự động cho giao diện (hiện chỉ test logic + bấm tay) |

### D. Nợ kỹ thuật nhỏ
- 3 cảnh báo lint có sẵn (`Toast.jsx`, `pickers.jsx`, `ui.jsx`); web bundle 760 kB (chưa tách chunk).
- Tên file log của `pino-roll` có số lạ (`app.2026-10-12.3612.log`), chỉ là cosmetic.
- `src/api/mockApi.js`, `src/data/mockData.js`, `src/lib/debt.js` không còn được app dùng; **giữ lại** vì test của
  `server/` dùng làm bản đối chiếu. Đừng xóa hay sửa công thức trong đó.
- Giao diện cần backend đang chạy; mất server thì app báo lỗi kết nối (không còn dùng offline như bản demo).

## 4. Bàn giao cho khách cần gì (khi A1–A4 xong)
1. Lệnh cài: `curl -fsSL <BASE_URL>/install.sh | bash` (macOS) hoặc `irm <BASE_URL>/install.ps1 | iex` (Windows, Admin).
2. Tên đăng nhập + mật khẩu do chính khách đặt lúc cài (không có mật khẩu mặc định).
3. Cách gửi file chẩn đoán khi lỗi, và cách khôi phục từ backup (cần C1/C2).
4. Cho khách biết: dữ liệu nằm trên máy họ; backup cloud nằm trong tài khoản R2 của bạn (không mã hóa phía client).

## 5. Lệnh hay dùng
```bash
# kiểm tra
cd server && npx tsc --noEmit && npm test     # 727 test
cd .. && npm test && npm run lint && npm run build

# chạy phát triển: xem README.md (backend rồi web)

# đóng gói / phát hành: xem server/packaging/README.md
```
