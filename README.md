# Quản lý công nợ khách hàng

Ứng dụng theo dõi công nợ khách hàng cho chủ cửa hàng: đơn hàng, hàng trả, thu tiền,
sao kê, bảng giá riêng từng khách. Giao diện (thư mục `src/`) nói chuyện với backend cục bộ
trong `server/` (xem `server/PLAN.md`); dữ liệu nằm trong SQLite trên máy cửa hàng.

## Chạy dự án (phát triển)

```bash
# 1) Backend — lần đầu tạo tài khoản chủ cửa hàng (mật khẩu đọc từ stdin, không để trên dòng lệnh)
cd server && npm install
echo 'mat-khau-cua-ban' | npx tsx src/main.ts init-admin --data-dir .data --username chucuahang --password-stdin
npm run dev        # http://127.0.0.1:8686 (dữ liệu trong server/.data)

# 2) Giao diện — terminal khác, ở thư mục gốc
npm install
npm run dev        # http://localhost:5173, tự chuyển /api sang backend
```

```bash
npm test           # kiểm thử hàm tính công nợ gốc (Vitest)
npm run build      # build production + PWA (manifest + service worker)
npm run lint       # oxlint
cd server && npm test   # kiểm thử backend (gồm so khớp với src/lib/debt.js)
```

## Công nợ được tính thế nào

Dư nợ khách tại ngày X = **Nợ đầu kỳ + Tổng đơn − Tổng hàng trả − Tổng thanh toán**
(chỉ cộng phát sinh có ngày ≤ X). Công nợ **gộp theo khách** — tiền thu trừ thẳng vào
nợ chung, không phân bổ theo đơn. Dư nợ luôn **tính lại** từ phát sinh mới nhất:
sửa đơn ngày cũ thì mọi ngày sau đều đổi đúng.

Backend tính công nợ bằng SQL (`server/src/modules/ledger`). `src/lib/debt.js` không còn được
giao diện dùng; nó được giữ làm **bản đối chiếu**: bộ test của `server/` sinh dữ liệu ngẫu nhiên
rồi so từng con số của backend với file này, nên đừng xóa hay sửa công thức trong đó.

## Cấu trúc thư mục

```
server/                 Backend cục bộ (Node + Fastify + SQLite). Xem server/PLAN.md.
src/
  api/client.js         fetch tới /api, lỗi chuẩn (ApiError), tự về trang đăng nhập khi hết phiên
  api/httpApi.js        Mọi lời gọi backend, gom theo nhóm; đổi dữ liệu về dạng các màn hình đã dùng
  api/errorReporting.js Gửi lỗi trình duyệt về backend để ghi log
  hooks/                useAsync (tải dữ liệu), useAction (lỗi -> toast), giá & hàng đã mua của khách
  lib/debt.js           Bản gốc tính công nợ — chỉ dùng để đối chiếu trong test của server/
  lib/format.js         fmtMoney (12.500), fmtDate (dd/mm/yyyy), uid, normalize...
  api/mockApi.js        Bản giả lập cũ — chỉ còn dùng để đối chiếu trong test của server/
  data/mockData.js      Dữ liệu mẫu của bản cũ, dùng trong test (debt.test.js, seed.test.js)
  store/useStore.js     Zustand: phiên đăng nhập, cài đặt, danh sách khách/sản phẩm/quy cách,
                        bản nháp đơn đang nhập. Dữ liệu còn lại do từng màn hình tự tải từ server.
  components/
    ui.jsx              Card, Button, Input, Modal, Confirm, Toast, Empty, Skeleton...
    pickers.jsx         PickerModal có tìm kiếm (chịu 1.000 khách), Avatar
    AppLayout.jsx       Bottom nav điện thoại + sidebar máy tính
    OrderTicket.jsx     Phiếu "HÓA ĐƠN BÁN LẺ" dùng chung cho xem / in / PDF / ảnh
    Toast.jsx           Thông báo toast
  pages/                12 màn hình (xem dưới)
```

## Màn hình

| Đường dẫn          | Màn hình                                                    |
| ------------------ | ----------------------------------------------------------- |
| `/dang-nhap`       | Đăng nhập                                                   |
| `/`                | Tổng quan: chọn ngày → tổng nợ, đơn/thu ngày + tháng, biểu đồ, top nợ |
| `/khach`           | Danh sách khách: tìm nhanh, dư nợ, sắp theo nợ, thêm khách  |
| `/khach/:id`       | Chi tiết: dư nợ đến ngày chọn, Sổ công nợ / Đơn / Bảng giá, nút nhanh |
| `/don-moi`         | Lập đơn — nhập nhanh mobile, giá tự điền từ bảng giá, lưu nháp |
| `/don-hang`        | Danh sách đơn: lọc ngày/khách, tổng cuối ngày               |
| `/don-hang/:id`    | Phiếu Hóa đơn bán lẻ: nợ cũ/nợ mới, In, PDF A5/A4, lưu ảnh, sửa, xóa mềm, lịch sử điều chỉnh |
| `/don-hang/:id/sua`| Sửa đơn — công nợ tự cập nhật, ghi lịch sử điều chỉnh        |
| `/hang-tra`        | Hàng trả — cảnh báo (không chặn) nếu trả vượt đã mua        |
| `/thu-tien`        | Thu tiền — trừ thẳng công nợ chung                          |
| `/san-pham`        | Sản phẩm & quy cách (thêm/sửa/xóa)                          |
| `/bang-gia`        | Bảng giá riêng từng khách + sao chép giá giữa khách          |
| `/sao-ke`          | Sao kê: Ngày/Diễn giải/Tăng/Giảm/Dư nợ, đánh dấu đơn sửa sau lần xuất gần nhất |
| `/cai-dat`         | Đổi mật khẩu, công tắc hiển thị nợ trên phiếu, thuế VAT, xuất công nợ CSV    |

## Ghi chú nối backend

- Đăng nhập thật bằng cookie phiên (`qlcn_sid`, httpOnly) do backend cấp.
- Trình duyệt chỉ giữ **bản nháp đơn đang nhập** (`localStorage`, khóa `qlcn-draft-v1`).
- Backend tự tính mọi số tiền của đơn (VAT, phí, hàng trả); form chỉ tính để xem trước.
- Sửa đơn gửi kèm `version`; nếu đơn đã bị sửa ở nơi khác, backend trả 409 và giao diện báo lại.
# Quan-Ly-Cong-No-Bao-Bi
