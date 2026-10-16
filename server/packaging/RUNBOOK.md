# Hướng dẫn phát hành và cài cho khách (macOS)

Dành cho người cài và hỗ trợ. Chi tiết kỹ thuật ở `README.md`.

## A. Chuẩn bị một lần

1. **Repo phát hành công khai** (chỉ chứa file build đã ký, không có source): tạo trên GitHub, ví dụ
   `Finnng1104/qlcn-releases`, để Public, thêm một commit bất kỳ (README) để repo không rỗng.
2. **Token**: GitHub → Settings → Developer settings → Fine-grained tokens → chọn repo `qlcn-releases`,
   quyền *Contents: Read and write*.
3. **Cấu hình repo mã nguồn** (Settings → Secrets and variables → Actions):

   | Loại | Tên | Giá trị |
   |---|---|---|
   | Secret | `QLCN_SIGNING_KEY` | toàn bộ nội dung `~/qlcn-signing-keys/main.private.pem` |
   | Secret | `QLCN_RELEASES_TOKEN` | token ở bước 2 |
   | Variable | `QLCN_RELEASES_REPO` | `Finnng1104/qlcn-releases` |
   | Variable | `QLCN_RELEASE_BASE_URL` | `https://github.com/Finnng1104/qlcn-releases/releases/latest/download` |

   Hoặc bằng lệnh: `gh secret set QLCN_SIGNING_KEY < ~/qlcn-signing-keys/main.private.pem`.
4. Khóa **private** chỉ nằm trên máy bạn và trong secret. Cất thêm một bản offline (USB/trình quản lý mật khẩu):
   mất khóa thì máy khách không nhận bản cập nhật nữa.

## B. Phát hành một bản

```
git tag v0.1.0
git push finn v0.1.0        # repo có secret ở trên
```

Workflow `release` build hai gói (Apple Silicon, Intel), ký manifest rồi tạo Release `v0.1.0` ở repo phát hành.
Xong khi tab Actions xanh và Release có đủ `install.sh`, `manifest.json`, `manifest.sig`, hai file `.tar.gz`.

## C. Cài và cập nhật trên máy khách

Xem `HUONG-DAN-CAI-DAT.md` (lệnh cài, danh sách kiểm tra, `qlcn update`). Hướng dẫn cho chủ shop ở
`HUONG-DAN-SU-DUNG.md`.

## D. Khi có sự cố

| Triệu chứng | Làm gì |
|---|---|
| Không vào được `localhost:8686` | `qlcn status`; nếu dừng thì `qlcn restart`; xem `qlcn logs` |
| Quên mật khẩu chủ shop | Chưa có lệnh đặt lại mật khẩu trong `qlcn` (việc còn thiếu). Dặn chủ shop ghi mật khẩu lại |
| Hỏng dữ liệu | `qlcn backups` rồi `qlcn restore <tên file>` |
| Cần gửi log | `qlcn doctor` tạo file chẩn đoán (không có dữ liệu khách) |
| Cài đặt lỗi | Log ở `~/Library/Application Support/QuanLyCongNo/logs/install-*.log` |

## E. Sao lưu ra ổ cứng ngoài và/hoặc R2

Hai nơi lưu ngoài máy, dùng được riêng hoặc cùng lúc (khách chọn theo nhu cầu):

**Ổ cứng ngoài** (không cần mạng, không đưa dữ liệu lên internet): khách tự bật trong app, ở
Cài đặt → Sao lưu dữ liệu → *Bật sao lưu ra ổ cứng ngoài*, chọn ổ đang cắm và cách dùng
(*Cắm thường xuyên* hoặc *Thỉnh thoảng mới cắm*). Bản sao nằm trong thư mục `QuanLyCongNo-SaoLuu` trên ổ.
- Ổ chưa cắm: bản sao xếp hàng, cắm lại thì tự chép phần còn thiếu (trong vòng 1 phút).
- Cắm thường xuyên: cảnh báo nếu quá 48 giờ chưa chép được. Thỉnh thoảng cắm: chỉ nhắc sau 14 ngày.
- App giữ 30 bản mới nhất trên ổ (`backup.destinationRetention`).
- **macOS hỏi quyền** truy cập ổ đĩa rời lần đầu: chọn Cho phép. Nếu lỡ từ chối: Cài đặt hệ thống →
  Quyền riêng tư & Bảo mật → Tệp và thư mục (hoặc Truy cập toàn bộ ổ đĩa) → bật cho `node`.
- Dữ liệu trên ổ không mã hóa: khuyên khách định dạng ổ kiểu APFS (Mã hóa) trong Disk Utility.

**R2 (online).** Mỗi shop một bucket và một token chỉ có quyền Object Read & Write trên bucket đó (Cloudflare →
R2 → tạo bucket → *Manage API tokens* → *Object Read & Write*, chọn đúng bucket).

Kết nối bằng một lệnh, hỏi lần lượt Account ID, tên bucket, Access Key ID, Secret:

```
qlcn backup-setup
```

Lệnh tự thử kết nối (liệt kê, ghi, xóa một file thử), lưu vào `config.json` (quyền chỉ chủ file đọc),
khởi động lại dịch vụ và sao lưu thử một bản. Sai quyền hoặc sai tên bucket thì báo lỗi và không ghi gì.
Chạy không cần hỏi: đặt `QLCN_R2_ACCOUNT_ID`, `QLCN_R2_BUCKET`, `QLCN_R2_ACCESS_KEY_ID`,
`QLCN_R2_SECRET_ACCESS_KEY` (tùy chọn `QLCN_R2_PREFIX`) trước lệnh.

Cách hoạt động:
- Mỗi bản sao lưu local được đẩy lên bucket. Mất mạng thì bản đó xếp hàng và tự đẩy lại (mỗi 10 phút)
  khi có mạng, kể cả sau khi tắt/bật máy.
- App tự giữ 30 bản mới nhất trên bucket (`backup.destinationRetention` trong `config.json`, 3–365) và
  xóa bản cũ hơn, nên không cần lifecycle rule.
- Trong app: Cài đặt → **Sao lưu dữ liệu** có nút *Sao lưu ngay*, danh sách bản (trên máy / online) và
  nút *Khôi phục*. Khôi phục tự lưu dữ liệu hiện tại trước, rồi app tự khởi động lại (vài giây).
  Khôi phục đưa cả mật khẩu và phiên đăng nhập về thời điểm của bản đó.
