# Hướng dẫn dùng phần mềm Quản lý công nợ

## 1. Mở phần mềm
- Bấm biểu tượng **Quản lý công nợ** trên thanh Dock (hàng biểu tượng ở đáy màn hình).
- Nếu chưa có, mở trình duyệt và vào địa chỉ **http://localhost:8686**
- Phần mềm chạy ngay trên máy này, **không cần internet** để sử dụng.

## 2. Đăng nhập lần đầu và đổi mật khẩu
1. Đăng nhập bằng tên và mật khẩu do người cài đặt cung cấp.
2. Vào **Cài đặt → Đổi mật khẩu**, đặt mật khẩu của riêng bạn.
3. Ghi mật khẩu ra giấy và cất kỹ. Hiện chưa có chức năng tự lấy lại mật khẩu khi quên.

## 3. Sử dụng hằng ngày
- Bật máy, **đăng nhập máy như bình thường**, đợi vài giây rồi mở phần mềm.
- Tắt máy bình thường như mọi khi, dữ liệu không bị mất.
- Nếu mở phần mềm báo không vào được, đợi 10–20 giây rồi tải lại trang.
- Máy có thể hiện thông báo "Hoạt động trong nền" từ "Node": đây là phần mềm đang chạy, bình thường. **Đừng tắt** mục này trong Cài đặt hệ thống, nếu không phần mềm sẽ không tự chạy.

## 4. Dữ liệu của bạn
- Dữ liệu nằm **trên máy này**, trong thư mục `QuanLyCongNo` (Library → Application Support).
- **Không xóa** thư mục này.
- Cách mở: trong **Finder**, bấm **Cmd + Shift + G**, dán dòng `~/Library/Application Support/QuanLyCongNo` rồi nhấn Enter.
- Nếu máy hỏng hoặc mất thì dữ liệu cũng mất. Hãy bật sao lưu ra ổ cứng ngoài trong Cài đặt (mục 5).

## 5. Sao lưu và khôi phục dữ liệu
- Phần mềm **tự sao lưu**: khi bật máy (nếu bản gần nhất đã cũ hơn 24 giờ) và khoảng 6 giờ một lần khi có thay đổi dữ liệu.
- Muốn sao lưu ngay: vào **Cài đặt → Sao lưu dữ liệu → Sao lưu ngay**.
- **Sao lưu ra ổ cứng ngoài**: cắm ổ vào máy, vào **Cài đặt → Sao lưu dữ liệu → Bật sao lưu ra ổ cứng ngoài**, chọn ổ và cách dùng:
  - *Cắm thường xuyên*: ổ luôn cắm trong máy, phần mềm báo nếu quá 2 ngày chưa sao lưu được.
  - *Thỉnh thoảng mới cắm*: mỗi lần bạn cắm ổ vào, phần mềm tự chép các bản còn thiếu (khoảng 1 phút), không cần bấm gì.
  - Lần đầu máy có thể hỏi quyền truy cập ổ đĩa: hãy chọn **Cho phép**.
  - Chỉ rút ổ sau khi bấm **Eject** (đẩy ổ ra) trong Finder.
- Nếu đã bật sao lưu online, các bản cũng **tự được đẩy lên online** khi có mạng.
- Cũng trong mục đó có **danh sách các bản sao lưu** (ngày giờ, nằm trên máy hay online).

### Khôi phục dữ liệu về một bản cũ
1. Vào **Cài đặt → Sao lưu dữ liệu**, tìm bản có ngày giờ bạn muốn.
2. Bấm **Khôi phục**, đọc kỹ rồi xác nhận.
3. Đợi vài giây, phần mềm tự khởi động lại và mở lại. Đăng nhập như bình thường.

Lưu ý: mọi đơn hàng, thanh toán, thay đổi (kể cả mật khẩu) **sau thời điểm của bản đó sẽ không còn**. Trước khi khôi phục, phần mềm tự lưu lại dữ liệu hiện tại thành một bản (loại "Trước khi khôi phục") nên vẫn quay lại được nếu chọn nhầm.
- Nếu chưa bật ổ cứng ngoài (hoặc online) thì các bản chỉ nằm trên máy, và **chưa an toàn nếu máy hỏng hoặc mất**. Hãy bật sao lưu ra ổ cứng ngoài.
- Các bản trên máy nằm trong thư mục **`backups`** bên trong thư mục `QuanLyCongNo` (máy giữ 7 bản gần nhất).

## 6. Cập nhật phần mềm khi có bản mới
Khi người hỗ trợ báo có bản mới, bạn làm như sau (mất khoảng 1–2 phút, **cần có internet**):
1. Mở **Terminal** (bấm Cmd + Space, gõ `Terminal`, nhấn Enter).
2. Dán dòng lệnh dưới đây vào rồi nhấn Enter:

   `"$HOME/Library/Application Support/QuanLyCongNo/app/bin/qlcn" update`

3. Đợi đến khi thấy dòng **"Đã cập nhật lên ..."** (hoặc "Đã là bản mới nhất"), rồi đóng Terminal.
4. Mở lại phần mềm như bình thường.

Bạn yên tâm: dữ liệu được **tự sao lưu trước khi cập nhật**, và nếu bản mới có lỗi thì phần mềm **tự quay về bản cũ**, không mất gì. Trong lúc cập nhật, đừng tắt máy.

## 7. Phạm vi sử dụng
Phần mềm hiện chỉ mở được trên đúng máy đã cài, chưa dùng được trên điện thoại hay máy khác.

## 8. Khi có sự cố
| Tình huống | Làm gì |
|---|---|
| Không vào được phần mềm | Đợi 20 giây rồi tải lại; vẫn không được thì khởi động lại máy |
| Quên mật khẩu | Liên hệ người hỗ trợ |
| Cần bản cập nhật mới | Làm theo mục 6, hoặc liên hệ người hỗ trợ |
| Có thông báo lỗi lạ | Chụp màn hình và gửi cho người hỗ trợ |

## Liên hệ hỗ trợ
Tên: ______________   Số điện thoại / Zalo: ______________
