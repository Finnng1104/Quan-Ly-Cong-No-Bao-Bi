# Đóng gói, cài đặt và cập nhật

Tài liệu ngắn về cách phát hành bản cài cho máy khách. Thiết kế đầy đủ ở `../PLAN.md` §11.
Các bước làm tay từ đầu đến cuối (phát hành, cài qua remote, backup R2) ở `RUNBOOK.md`.

## Cài đặt trên máy khách

```
macOS    curl -fsSL <BASE_URL>/install.sh | bash
Windows  irm <BASE_URL>/install.ps1 | iex        (PowerShell mở bằng "Run as administrator")
```

Chạy lại đúng lệnh đó để cập nhật. Script tự: kiểm chữ ký, tải gói, kiểm sha256, sao lưu dữ liệu, thay bản
chạy, kiểm tra sức khỏe, và **quay lại bản cũ cùng dữ liệu cũ** nếu bản mới không chạy.

## Lệnh hỗ trợ `qlcn` (dùng khi hỗ trợ từ xa)

Có sẵn trong gói cài (`app/bin/`). Installer đưa lên PATH: Windows luôn (mở cửa sổ PowerShell mới),
macOS chỉ khi `/usr/local/bin` ghi được không cần sudo — nếu không, installer in đường dẫn đầy đủ.

```
qlcn status                 phiên bản, cổng, dịch vụ, /api/health
qlcn start | stop | restart dịch vụ chạy nền (Windows: PowerShell "Run as administrator")
qlcn update                 tải và cài bản mới nhất (tự sao lưu, tự quay lại nếu lỗi)
qlcn backup                 sao lưu ngay, dịch vụ vẫn chạy
qlcn backups                liệt kê bản sao lưu trên máy
qlcn restore <file|ngày>    tự dừng dịch vụ → khôi phục → bật lại; ngày theo giờ VN (YYYY-MM-DD)
qlcn doctor                 tạo file chẩn đoán (không có dữ liệu khách) và mở thư mục chứa nó
qlcn logs                   mở thư mục log
```

`restore` luôn chụp dữ liệu hiện tại thành `...-pre-restore.db.gz` trước, nên hoàn tác được bằng
`qlcn restore <tên file pre-restore>`. Lưu ý: `restore <ngày>` lấy bản **mới nhất** của ngày đó, kể cả
bản `pre-restore` — muốn chắc chắn thì chỉ rõ tên file lấy từ `qlcn backups`.

## Phát hành một bản

1. Tạo khóa (một lần): `node packaging/manifest.mjs keygen main` và `... keygen backup`.
   Giữ khóa **private** ngoài repo (lưu offline một bản). Commit hai file `*.public.pem` vào
   `packaging/public-keys/`.
2. Gắn tag `vX.Y.Z` — workflow `.github/workflows/release.yml` build macOS (arm64 + Intel), ký manifest và đăng lên Release của repo phát hành công khai.
   Hoặc làm tay trên từng máy:
   ```
   node packaging/build-release.mjs --out release --version X.Y.Z
   node packaging/manifest.mjs publish --dir release --base-url <BASE_URL> \
        --key <main.private.pem> --public-key <main.public.pem> --public-key <backup.public.pem>
   ```
3. Đưa nội dung thư mục `release/` (các `.tar.gz`, `manifest.*`, `install.sh`, `install.ps1`) lên nơi phát hành.
   **`install.ps1` phải được phục vụ với `Content-Type: text/plain; charset=utf-8`.** Thiếu charset thì
   Windows PowerShell 5.1 (`irm | iex`) đọc theo ISO-8859-1 và thông báo tiếng Việt bị lỗi chữ. Đừng thêm BOM:
   BOM làm hỏng dòng đầu khi chạy qua `iex`. Với R2 đặt metadata lúc upload, ví dụ
   `aws s3 cp install.ps1 s3://<bucket>/ --content-type "text/plain; charset=utf-8"`.

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
| macOS: `qlcn` status/backup/backups/restore (theo tên file, theo ngày, file hỏng, hoàn tác) | Đã thử trên máy thật |
| Windows: `install.ps1`, `qlcn.ps1`, Task Scheduler, `LocalService`, kiểm chữ ký bằng CNG | Đã chạy trên CI `windows-latest` (cài mới, đăng nhập, backup, chạy lại); chưa thử máy thật |
| CI workflow `release.yml` (macOS arm64 + Intel, đăng Release) | Chưa chạy (cần secret/variable và repo phát hành, xem `RUNBOOK.md`) |
| Tự khởi động lại sau khi tắt/mở máy, rút sạc laptop | Chưa |
