# Quản lý công nợ khách hàng — Giai đoạn 1 (giao diện)

Ứng dụng theo dõi công nợ khách hàng cho chủ cửa hàng: đơn hàng, hàng trả, thu tiền,
sao kê, bảng giá riêng từng khách. Giai đoạn này **chưa có backend** — dùng dữ liệu mẫu
và lưu trạng thái vào `localStorage` (tải lại trang không mất).

## Chạy dự án

```bash
npm install
npm run dev        # http://localhost:5173
```

Đăng nhập giả lập: bất kỳ tên đăng nhập nào + mật khẩu `123456` (đổi được trong Cài đặt).

```bash
npm test           # chạy kiểm thử hàm tính công nợ (Vitest)
npm run build      # build production + PWA (manifest + service worker)
npm run lint       # oxlint
```

## Công nợ được tính thế nào

Dư nợ khách tại ngày X = **Nợ đầu kỳ + Tổng đơn − Tổng hàng trả − Tổng thanh toán**
(chỉ cộng phát sinh có ngày ≤ X). Công nợ **gộp theo khách** — tiền thu trừ thẳng vào
nợ chung, không phân bổ theo đơn. Dư nợ luôn **tính lại** từ phát sinh mới nhất:
sửa đơn ngày cũ thì mọi ngày sau đều đổi đúng.

Toàn bộ logic này nằm trong `src/lib/debt.js` — hàm thuần, có test (`debt.test.js`,
`seed.test.js`), tái sử dụng trực tiếp cho backend giai đoạn 2.

## Cấu trúc thư mục

```
src/
  api/mockApi.js        Lớp service giả lập API — giai đoạn 2 thay bằng fetch() tới backend.
                        Mọi hàm nhận state, trả về phần state mới. Component không đụng dữ liệu trực tiếp.
  lib/debt.js           Hàm thuần tính công nợ: balanceAt, ledgerRows, diffOrders... (dùng lại ở backend)
  lib/format.js         fmtMoney (12.500), fmtDate (dd/mm/yyyy), uid, normalize...
  data/mockData.js      Dữ liệu mẫu: 15 khách (Thanh Nhi nợ đầu kỳ 59.356, ông A), 9 sản phẩm,
                        6 quy cách, bảng giá riêng, ~33 đơn (2 đơn đã điều chỉnh), trả hàng, thanh toán
  store/useStore.js     Zustand + persist localStorage — mọi action gọi qua mockApi
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
| `/dang-nhap`       | Đăng nhập (giả lập)                                         |
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
| `/cai-dat`         | Đổi mật khẩu, công tắc hiển thị nợ trên phiếu, xuất JSON    |

## Nối backend ở giai đoạn 2

- Thay từng hàm trong `src/api/mockApi.js` bằng `fetch()` tới REST API tương ứng
  (giữ nguyên chữ ký hàm → component không phải sửa).
- Mang `src/lib/debt.js` + `format.js` sang server để backend tính đúng cùng công thức;
  hoặc giữ tính ở client nếu backend trả đủ phát sinh.
- Đăng nhập giả lập trong `useStore.login` → thay bằng gọi API auth + token.
- `localStorage` persist có thể bỏ hoặc giữ làm cache/offline.
# Quan-Ly-Cong-No-Bao-Bi
