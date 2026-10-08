# ITS Smart Traffic

Giao diện giám sát giao thông gồm đăng nhập `user/admin`, đăng ký User bằng email, dashboard, camera, nhận diện biển số và khu vực quản trị.

## Quy tắc tài khoản

- **User:** đăng ký tài khoản bằng email và đăng nhập bằng email.
- **Admin:** không có chức năng tự đăng ký; đăng nhập bằng `username` quản trị được cấp riêng.
- Mật khẩu phải được lưu dưới dạng hash ở backend, không lưu mật khẩu thô trong frontend hoặc MySQL.

## Cấu trúc

```text
frontend/   React + Vite interface và lớp gọi API
backend/    Express API, MySQL connection
database/   MySQL schema
ai/         nơi đặt service Python OpenCV/YOLO/OCR
```

## Chạy giao diện React

```bash
cd frontend
npm install
npm run build

cd backend
npm install
npm run dev
```

Mở `http://localhost:3000`. Express phục vụ bản build trong `frontend/dist`. Khi phát triển giao diện, chạy `npm run dev` trong `frontend` và cấu hình proxy API nếu cần. React gọi `/api/auth/login`, `/api/auth/register`, `/api/auth/verify-email` và `/api/dashboard`; dữ liệu nghiệp vụ được lấy từ MySQL qua backend.

### Tải ảnh/video để nhận diện

Trong màn Admin, tại khối **Hình ảnh & nhận diện biển số**, chọn **Thêm ảnh / video**.
Backend nhận ảnh/video qua `POST /api/dashboard/upload`, lưu tệp tại `backend/uploads/`
và tạo bản ghi chờ xử lý trong `plate_detections`. Tệp được giới hạn 100 MB và chỉ nhận
image/video. Kết quả biển số chỉ được hiển thị sau khi service Python YOLO/OCR cập nhật
`plate_raw`, `plate_normalized`, `vehicle_class` và `confidence`; hệ thống không tự tạo
kết quả nhận diện khi AI chưa kết nối.

## Luồng dữ liệu dự kiến

`Python AI -> Express API -> MySQL -> Express API -> frontend`

Chạy `database/schema.sql` trên MySQL Workbench hoặc MySQL CLI trước khi triển khai phần truy vấn thật. Schema này sử dụng database `its_toll`.

Tạo `backend/.env` từ `backend/.env.example`, sau đó điền mật khẩu MySQL Workbench của tài khoản `root`:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=its_toll
MYSQL_USER=root
MYSQL_PASSWORD=mat_khau_mysql_cua_ban
```

Không đặt mật khẩu thật trong `db.js` hoặc commit file `.env`.

### Cấu hình Gmail gửi mã kích hoạt

`MAIL_USER` phải là địa chỉ Gmail dùng để gửi thư. `MAIL_PASSWORD` không phải
mật khẩu Gmail thông thường mà là **App Password gồm 16 ký tự**:

1. Bật xác minh 2 bước cho tài khoản Google.
2. Mở trang [App passwords](https://myaccount.google.com/apppasswords).
3. Tạo một App Password mới cho ứng dụng ITS Smart Traffic.
4. Dán 16 ký tự vào `MAIL_PASSWORD` trong `backend/.env`. Có thể dán cả khoảng
   trắng; backend sẽ tự loại bỏ khoảng trắng.
5. Đặt `MAIL_FROM` dùng chính địa chỉ trong `MAIL_USER`, rồi khởi động lại backend.

Nếu Gmail báo lỗi `535-5.7.8`, hãy tạo App Password mới và kiểm tra
`MAIL_USER` có đúng tài khoản đã tạo App Password hay không.
