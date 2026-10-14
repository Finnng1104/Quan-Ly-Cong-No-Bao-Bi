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

## C. Cài trên máy khách (qua AnyDesk/RustDesk)

Trước giờ hẹn hỏi khách: Mac chip gì (Apple menu → About This Mac), đang đăng nhập tài khoản nào, và có
mở sẵn được Terminal không.

1. Mở **Terminal** trên máy khách (không cần sudo).
2. Chạy:
   ```
   curl -fsSL https://github.com/Finnng1104/qlcn-releases/releases/latest/download/install.sh | bash
   ```
3. Script hỏi tên đăng nhập và mật khẩu của chủ shop (hoặc để chủ shop tự gõ). Chờ tới khi báo cài xong
   và mở trình duyệt tại `http://localhost:8686`.
4. Kiểm tra:
   - Đăng nhập được bằng tài khoản vừa tạo.
   - Tạo thử một khách hàng và một đơn.
   - `qlcn status` hiện dịch vụ đang chạy; `qlcn backup` báo thành công.
5. **Đăng xuất rồi đăng nhập lại** (hoặc khởi động lại máy) và mở lại `http://localhost:8686`: dịch vụ phải
   tự lên. Dịch vụ chạy theo *tài khoản đang đăng nhập* (LaunchAgent), nên máy chưa đăng nhập thì chưa chạy.
6. Cài app vào Dock/Home Screen từ trình duyệt (Chrome/Edge: Install; Safari: Add to Dock) cho chủ shop.

## D. Cập nhật

Phát hành tag mới (mục B), rồi chạy lại đúng lệnh ở mục C. Script tự sao lưu, thay bản, kiểm tra, và
quay lại bản cũ nếu bản mới không chạy.

## E. Khi có sự cố

| Triệu chứng | Làm gì |
|---|---|
| Không vào được `localhost:8686` | `qlcn status`; nếu dừng thì `qlcn restart`; xem `qlcn logs` |
| Quên mật khẩu chủ shop | Chưa có lệnh đặt lại mật khẩu trong `qlcn` (việc còn thiếu). Dặn chủ shop ghi mật khẩu lại |
| Hỏng dữ liệu | `qlcn backups` rồi `qlcn restore <tên file>` |
| Cần gửi log | `qlcn doctor` tạo file chẩn đoán (không có dữ liệu khách) |
| Cài đặt lỗi | Log ở `~/Library/Application Support/QuanLyCongNo/logs/install-*.log` |

## F. Backup lên R2 (khi có tài khoản Cloudflare)

Mỗi shop một bucket và một token chỉ có quyền Object Read & Write trên bucket đó. Thêm vào
`~/Library/Application Support/QuanLyCongNo/config.json` rồi `qlcn restart`:

```json
{
  "backup": {
    "localRetention": 7,
    "destinations": [
      {
        "type": "s3",
        "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
        "bucket": "qlcn-<ten-shop>",
        "accessKeyId": "...",
        "secretAccessKey": "..."
      }
    ]
  }
}
```

Kiểm tra bằng `qlcn backup`. Giữ bản cũ bằng *lifecycle rule* của bucket (app không tự xóa trên cloud).
