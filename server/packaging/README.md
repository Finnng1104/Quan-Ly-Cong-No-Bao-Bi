# Đóng gói, cài đặt và cập nhật

Tài liệu ngắn về cách phát hành bản cài cho máy khách. Thiết kế đầy đủ ở `../PLAN.md` §11.

## Cài đặt trên máy khách

```
macOS    curl -fsSL <BASE_URL>/install.sh | bash
Windows  irm <BASE_URL>/install.ps1 | iex        (PowerShell mở bằng "Run as administrator")
```

Chạy lại đúng lệnh đó để cập nhật. Script tự: kiểm chữ ký, tải gói, kiểm sha256, sao lưu dữ liệu, thay bản
chạy, kiểm tra sức khỏe, và **quay lại bản cũ cùng dữ liệu cũ** nếu bản mới không chạy.

## Phát hành một bản

1. Tạo khóa (một lần): `node packaging/manifest.mjs keygen main` và `... keygen backup`.
   Giữ khóa **private** ngoài repo (lưu offline một bản). Commit hai file `*.public.pem` vào
   `packaging/public-keys/`.
2. Gắn tag `vX.Y.Z` — workflow `.github/workflows/release.yml` build 3 nền tảng, ký manifest.
   Hoặc làm tay trên từng máy:
   ```
   node packaging/build-release.mjs --out release --version X.Y.Z
   node packaging/manifest.mjs publish --dir release --base-url <BASE_URL> \
        --key <main.private.pem> --public-key <main.public.pem> --public-key <backup.public.pem>
   ```
3. Đưa nội dung thư mục `release/` (các `.tar.gz`, `manifest.*`, `install.sh`, `install.ps1`) lên nơi phát hành.

## Thử cài trên máy mình mà không đụng bản thật

Các biến môi trường dưới đây làm script dùng thư mục/nhãn/cổng riêng:

```
QLCN_BASE_URL=http://127.0.0.1:9100  QLCN_HOME=/tmp/qlcn-test  QLCN_LABEL=vn.qlcn.test
QLCN_PORT=8799  QLCN_ADMIN_USERNAME=... QLCN_ADMIN_PASSWORD=...  QLCN_NO_OPEN=1  bash release/install.sh
```

Để thử rollback: `build-release.mjs --simulate-broken --version X.Y.Z` tạo một bản cố ý hỏng.
Gỡ bản thử: `launchctl bootout gui/$(id -u)/vn.qlcn.test` rồi xóa `~/Library/LaunchAgents/vn.qlcn.test.plist`.

## Đã thử và chưa thử

| | Trạng thái |
|---|---|
| macOS (arm64): cài mới, cập nhật 0.0.1→0.0.2, rollback khi bản mới hỏng, manifest bị sửa bị từ chối, chạy lại cùng bản không đổi gì, supervisor chạy lại khi tiến trình bị giết | Đã thử trên máy thật |
| macOS Intel (x64) | Chưa (cần build trên máy Intel hoặc CI) |
| Windows: `install.ps1`, Task Scheduler, `LocalService`, kiểm chữ ký bằng CNG | **Chưa chạy trên Windows thật** |
| CI workflow | Chưa chạy (cần repo GitHub) |
| Tự khởi động lại sau khi tắt/mở máy, rút sạc laptop | Chưa |
