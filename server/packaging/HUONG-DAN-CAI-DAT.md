# Cài đặt cho khách (macOS) qua remote

Dành cho người cài và hỗ trợ. Phát hành, backup R2 và xử lý sự cố ở `RUNBOOK.md`.

## Trước buổi hẹn
- Hỏi khách: Mac chip gì, có Apple ID/iMessage chưa (dùng Chia sẻ màn hình của Apple) hay sẽ cài AnyDesk.
- Dặn khách: cắm sạc, mạng ổn, mở nắp máy, đừng tắt máy giữa chừng.
- Xác nhận Release mới nhất đã có ở `github.com/Finnng1104/qlcn-releases` (nhãn *Latest*).

## Cài (khoảng 5 phút)
1. Kết nối remote, mở **Terminal** trên máy khách (Cmd+Space, gõ Terminal).
2. Dán một dòng:
   ```
   QLCN_ADMIN_USERNAME=admin QLCN_ADMIN_PASSWORD=admin123 bash -c "$(curl -fsSL https://github.com/Finnng1104/qlcn-releases/releases/latest/download/install.sh)"
   ```
   Muốn tên đăng nhập hoặc mật khẩu khác thì đổi hai giá trị ở đầu dòng (tên đăng nhập chưa đổi được
   sau khi tạo, nên chốt tên đúng ngay từ đầu).
3. Chờ dòng "Cài đặt xong. Ứng dụng chạy tại http://localhost:8686".
4. Nếu lỗi: chụp màn hình, xem `~/Library/Application Support/QuanLyCongNo/logs/install-*.log`.

## Kiểm tra
Lệnh hỗ trợ (đường dẫn đầy đủ, vì `qlcn` có thể chưa nằm trong PATH):
```
Q="$HOME/Library/Application Support/QuanLyCongNo/app/bin/qlcn"
```
- [ ] Mở http://localhost:8686, đăng nhập `admin` / `admin123`.
- [ ] **Đổi mật khẩu ngay** (Cài đặt → Đổi mật khẩu), ngồi cạnh khách làm cùng.
- [ ] Tạo thử một khách hàng và một đơn.
- [ ] `"$Q" status` báo dịch vụ chạy và sức khỏe `ok`; `"$Q" backup` thành công.
- [ ] **Đăng xuất macOS rồi đăng nhập lại**, mở lại http://localhost:8686: phải tự lên (báo khách trước
      vì remote sẽ bị ngắt).
- [ ] `"$Q" backups` liệt kê bản vừa tạo. Backup tự chạy sau đó theo sự kiện (24 giờ / 6 giờ), giữ 7 bản; bản ngoài máy (R2) bật sau theo `RUNBOOK.md` mục E.
- [ ] Cài vào Dock (Chrome/Edge: Install; Safari: File → Add to Dock).
- [ ] Điền tên và số điện thoại hỗ trợ vào `HUONG-DAN-SU-DUNG.md` rồi gửi khách.

## Cập nhật sau này
Phát hành tag mới (`git tag vX.Y.Z` rồi `git push finn vX.Y.Z`), sau đó trên máy khách chạy:
```
"$Q" update
```
Tự sao lưu, thay bản, kiểm tra, quay lại bản cũ nếu lỗi. `qlcn update` có trên bản cài từ v0.1.1; bản
v0.1.0 cập nhật một lần bằng lệnh cài ở trên.

## Gỡ về sạch nếu hỏng (chỉ khi chưa có dữ liệu thật)
```
launchctl bootout gui/$(id -u)/vn.qlcn.server
rm -f ~/Library/LaunchAgents/vn.qlcn.server.plist
rm -rf "$HOME/Library/Application Support/QuanLyCongNo"
```
Lệnh cuối xóa luôn dữ liệu. Sau đó chạy lại lệnh cài.

## Ghi lại sau buổi
Chip máy, kết quả kiểm tra tự lên sau khi đăng nhập, sự cố hoặc antivirus chặn (nếu có).
