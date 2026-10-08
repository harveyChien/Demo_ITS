# AI service

Đặt pipeline Python ở thư mục này:

- `OpenCV`: đọc camera/video và cắt frame.
- `YOLO`: phát hiện xe và vùng biển số.
- `OCR`: đọc ký tự biển số.
- Gửi kết quả nhận diện về backend Express qua HTTP, không ghi dữ liệu trực tiếp vào frontend.

Các endpoint dự kiến: `POST /recognitions`, `GET /health`.
