# Đưa app lên mạng cho khách dùng thử

Giao diện chạy trên **Vercel**, backend chạy trên một server có ổ đĩa lưu dữ liệu (ví dụ **Railway**). Vercel
chuyển mọi lệnh gọi `/api/...` sang backend (`vercel.json`), nên với trình duyệt mọi thứ nằm cùng một địa chỉ:
cookie đăng nhập hoạt động cả trên Safari/iPhone, không cần cấu hình CORS.

```
Trình duyệt ──► https://<app>.vercel.app ──(/api/*)──► https://<backend>.up.railway.app ──► /data (volume)
```

Bản cài trên máy khách (`server/packaging/`) **không** dùng file này và không bị ảnh hưởng: chế độ online chỉ bật
khi có biến `QLCN_PUBLIC_URLS`.

## 1. Backend (Railway)

1. **New Project → Deploy from GitHub repo** → chọn repo. Trong **Settings** của service:
   - **Root Directory**: `server` (Railway tự thấy `server/Dockerfile`).
2. **Volume**: chuột phải service → **Attach volume** → Mount path **`/data`**.
   Không có volume thì mỗi lần deploy lại là **mất sạch dữ liệu**.
3. **Variables**:

   | Biến | Giá trị |
   |---|---|
   | `QLCN_PUBLIC_URLS` | `https://<app>.vercel.app,https://<backend>.up.railway.app` (cả hai, cách nhau dấu phẩy, phải https) |
   | `QLCN_ADMIN_USERNAME` | tên đăng nhập chủ shop |
   | `QLCN_ADMIN_PASSWORD` | mật khẩu (≥ 8 ký tự). Chỉ dùng để tạo tài khoản **lần đầu**; xóa biến này sau khi đăng nhập được |

   Không cần đặt `PORT` (Railway tự đặt) hay `QLCN_DATA_DIR` (image đã đặt `/data`).
4. **Settings → Networking → Generate Domain** để có địa chỉ `https://<backend>.up.railway.app`.
   Sửa lại `QLCN_PUBLIC_URLS` cho đúng địa chỉ này nếu bước 3 điền trước.
5. Kiểm tra: mở `https://<backend>.up.railway.app/api/health` → thấy `"status":"ok"`.

## 2. Giao diện (Vercel)

1. Sửa **`vercel.json`**: thay `SET-BACKEND-URL.invalid` bằng địa chỉ backend ở bước 1.4, commit.
2. Vercel → **Add New Project** → chọn repo. Root Directory để **trống** (thư mục gốc). Vercel tự nhận Vite
   (`npm run build`, thư mục `dist`). Không cần biến môi trường.
3. Lấy địa chỉ `https://<app>.vercel.app`, đảm bảo nó có trong `QLCN_PUBLIC_URLS` của backend
   (đổi biến thì Railway tự chạy lại).

Muốn dùng tên miền riêng: thêm nó vào `QLCN_PUBLIC_URLS`.

## 3. Thử sau khi deploy

1. Mở địa chỉ Vercel → đăng nhập bằng tài khoản ở bước 1.3.
2. Tạo 1 khách, 1 đơn → tải lại trang vẫn còn.
3. Railway → **Redeploy** → dữ liệu vẫn còn (chứng minh volume đúng).
4. Thử trên điện thoại (Safari iPhone nếu có).

| Gặp | Nguyên nhân thường gặp |
|---|---|
| "Không kết nối được máy chủ" | Chưa sửa `vercel.json`, hoặc backend chưa chạy (`/api/health`) |
| "Nguồn yêu cầu không hợp lệ" / "Địa chỉ truy cập không hợp lệ" | Địa chỉ Vercel hoặc backend thiếu/sai trong `QLCN_PUBLIC_URLS` (phải đúng `https://`, không có đường dẫn phía sau) |
| Đăng nhập xong vẫn bị đá về trang đăng nhập | Đang mở bằng `http://` thay vì `https://` |
| Backend không khởi động, log báo `QLCN_PUBLIC_URLS must use https` | Có địa chỉ `http://` trong biến |

## Lưu ý

- **Dữ liệu nằm trên volume Railway.** Bản sao lưu tự động cũng nằm trên chính volume đó, nên mất volume là mất
  cả bản sao lưu. Đây là bản dùng thử; dữ liệu thật nên chuyển về bản cài trên máy khách (backup + restore) khi
  chốt.
- Server online ai cũng truy cập được: khóa đăng nhập sau nhiều lần sai vẫn hoạt động, nhưng hãy dùng mật khẩu mạnh.
- Chạy thử image trên máy: `cd server && docker build -t qlcn-server .` rồi
  `docker run -p 9200:9200 -v "$PWD/.docker-data:/data" -e PORT=9200 -e QLCN_PUBLIC_URLS=https://qlcn.vercel.app -e QLCN_ADMIN_USERNAME=chu -e QLCN_ADMIN_PASSWORD=... qlcn-server`.
