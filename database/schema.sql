/* =====================================================================
   HỆ THỐNG THU PHÍ ITS - NHẬN DIỆN BIỂN SỐ (YOLO + OCR)
   File schema MySQL hoàn chỉnh - chạy 1 lần từ trên xuống dưới.

   YÊU CẦU : MySQL 8.0.16+ (để CHECK constraint có tác dụng)
   CÁCH CHẠY: mysql -u root -p < its_toll_schema.sql

   QUY ƯỚC CHUNG
   - Engine InnoDB, charset utf8mb4: hỗ trợ transaction + khóa ngoại.
   - Tiền dùng BIGINT, đơn vị VNĐ (không dùng FLOAT/DOUBLE vì sai số).
   - Ảnh/video KHÔNG lưu trong DB, chỉ lưu đường dẫn file.
   - Biển số lưu dạng chuẩn hóa (bỏ dấu cách, gạch, chấm, viết hoa):
       "30A-123.45"  ->  "30A12345"
   - Mọi thay đổi số dư ví phải ghi vào wallet_transactions
     và nằm trong cùng 1 transaction với việc cập nhật accounts.

   MỤC LỤC
     0. Tạo database
     1. Người dùng & xác thực (users, refresh_tokens, verification_tokens)
     2. Khách hàng, loại xe, phương tiện
     3. Trạm, làn, thiết bị, biểu phí
     4. Nhận diện biển số (từ Python)
     5. Giao dịch thu phí
     6. Ví, nạp tiền, sổ cái
     7. Miễn/giảm phí, vé tháng
     8. Thống kê, nhật ký
     9. Dữ liệu khởi tạo (seed)
    10. Phân quyền user MySQL
   ===================================================================== */


/* ---------------------------------------------------------------------
   0. TẠO DATABASE
   --------------------------------------------------------------------- */
CREATE DATABASE IF NOT EXISTS its_toll
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE its_toll;


/* ---------------------------------------------------------------------
   1. NGƯỜI DÙNG & XÁC THỰC
   --------------------------------------------------------------------- */

-- Tài khoản đăng nhập của TẤT CẢ mọi người: admin, nhân viên, kế toán, khách hàng.
-- Phân biệt bằng cột role.
CREATE TABLE users (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  username            VARCHAR(50)  NULL UNIQUE,
  password_hash       VARCHAR(255) NOT NULL,            -- băm bcrypt, TUYỆT ĐỐI không lưu mật khẩu thô
  full_name           VARCHAR(100),
  email               VARCHAR(100) NULL UNIQUE,
  phone               VARCHAR(20)  NULL UNIQUE,
  role                ENUM('admin','operator','accountant','customer')
                      NOT NULL DEFAULT 'customer',      -- admin: toàn quyền | operator: vận hành trạm
                                                        -- accountant: kế toán | customer: chủ xe
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,  -- 0 = khóa tài khoản
  email_verified_at   DATETIME     NULL,                -- NULL = chưa xác minh email
  failed_login_count  TINYINT      NOT NULL DEFAULT 0,  -- đếm lần đăng nhập sai liên tiếp
  locked_until        DATETIME     NULL,                -- khóa tạm thời nếu sai quá nhiều lần
  last_login_at       DATETIME     NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Refresh token (dùng khi đăng nhập bằng JWT).
-- Cho phép đăng xuất, thu hồi phiên đăng nhập từ xa.
CREATE TABLE refresh_tokens (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,   -- SHA-256 của token, KHÔNG lưu token thô
  expires_at  DATETIME     NOT NULL,
  revoked_at  DATETIME     NULL,              -- có giá trị = token đã bị thu hồi
  user_agent  VARCHAR(255),
  ip_address  VARCHAR(45),                    -- 45 ký tự đủ cho IPv6
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rt_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Token dùng 1 lần: xác minh email, quên mật khẩu.
CREATE TABLE verification_tokens (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  type        ENUM('verify_email','reset_password') NOT NULL,
  token_hash  CHAR(64)     NOT NULL UNIQUE,
  expires_at  DATETIME     NOT NULL,
  used_at     DATETIME     NULL,              -- đã dùng thì không dùng lại được
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   2. KHÁCH HÀNG, LOẠI XE, PHƯƠNG TIỆN
   --------------------------------------------------------------------- */

-- Chủ phương tiện. user_id nối tới tài khoản đăng nhập (nếu khách tự đăng ký).
-- Khách do nhân viên tạo tại quầy có thể chưa có user_id (NULL).
CREATE TABLE customers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NULL UNIQUE,
  full_name   VARCHAR(100) NOT NULL,
  phone       VARCHAR(20),
  email       VARCHAR(100),
  id_number   VARCHAR(20),                    -- CCCD hoặc mã số thuế
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Danh mục loại xe, dùng để tra biểu phí.
CREATE TABLE vehicle_types (
  id    TINYINT AUTO_INCREMENT PRIMARY KEY,
  code  VARCHAR(20)  NOT NULL UNIQUE,         -- ví dụ: CAR_4, TRUCK_2T, BUS
  name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- Phương tiện đăng ký. Xe mới đăng ký ở trạng thái 'pending', admin duyệt -> 'active'.
CREATE TABLE vehicles (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  customer_id            INT         NOT NULL,
  vehicle_type_id        TINYINT     NOT NULL,
  plate_normalized       VARCHAR(15) NOT NULL UNIQUE,   -- khóa so khớp, ví dụ 30A12345
  plate_display          VARCHAR(20),                   -- để hiển thị, ví dụ 30A-123.45
  status                 ENUM('pending','active','rejected','blacklisted','inactive')
                         NOT NULL DEFAULT 'pending',
  registration_doc_path  VARCHAR(255) NULL,             -- ảnh giấy đăng ký xe (cà vẹt)
  approved_by            INT          NULL,             -- admin duyệt
  approved_at            DATETIME     NULL,
  reject_reason          VARCHAR(255) NULL,             -- lý do nếu bị từ chối
  created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vehicle_status (status),
  FOREIGN KEY (customer_id)     REFERENCES customers(id),
  FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id),
  FOREIGN KEY (approved_by)     REFERENCES users(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   3. TRẠM, LÀN, THIẾT BỊ, BIỂU PHÍ
   --------------------------------------------------------------------- */

CREATE TABLE toll_stations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20)  NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  location   VARCHAR(255),
  is_active  TINYINT(1)   NOT NULL DEFAULT 1       -- 0 = ngưng hoạt động / bảo trì
) ENGINE=InnoDB;

CREATE TABLE lanes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  station_id  INT         NOT NULL,
  lane_no     TINYINT     NOT NULL,                -- số thứ tự làn trong trạm
  direction   ENUM('in','out','both') NOT NULL DEFAULT 'both',
  camera_url  VARCHAR(255),                        -- RTSP/HTTP của camera làn này
  is_active   TINYINT(1)  NOT NULL DEFAULT 1,
  UNIQUE KEY uq_station_lane (station_id, lane_no),
  FOREIGN KEY (station_id) REFERENCES toll_stations(id)
) ENGINE=InnoDB;

-- Thiết bị trên làn (camera, đầu đọc RFID, barie, cảm biến) để theo dõi tình trạng.
CREATE TABLE devices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  lane_id       INT NOT NULL,
  type          ENUM('camera','rfid_reader','barrier','sensor') NOT NULL,
  name          VARCHAR(100),
  status        ENUM('online','offline','maintenance') NOT NULL DEFAULT 'online',
  last_seen_at  DATETIME NULL,                     -- lần cuối thiết bị báo "còn sống"
  FOREIGN KEY (lane_id) REFERENCES lanes(id)
) ENGINE=InnoDB;

-- Biểu phí theo trạm + loại xe + khoảng thời gian hiệu lực.
-- Khi đổi giá: KHÔNG sửa dòng cũ, hãy đóng dòng cũ (effective_to) và thêm dòng mới.
-- Như vậy giao dịch cũ vẫn truy được mức phí tại thời điểm đó.
CREATE TABLE toll_rates (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  station_id       INT     NOT NULL,
  vehicle_type_id  TINYINT NOT NULL,
  fee              BIGINT  NOT NULL,               -- VNĐ
  effective_from   DATE    NOT NULL,
  effective_to     DATE    NULL,                   -- NULL = đang áp dụng, chưa có ngày kết thúc
  INDEX idx_rate_lookup (station_id, vehicle_type_id, effective_from),
  FOREIGN KEY (station_id)      REFERENCES toll_stations(id),
  FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   4. NHẬN DIỆN BIỂN SỐ (kết quả từ Python: YOLO + OCR)
   Bảng log lớn, tăng nhanh. Khi dữ liệu lên hàng chục triệu dòng
   nên cân nhắc PARTITION theo tháng hoặc lưu trữ (archive) dữ liệu cũ.
   --------------------------------------------------------------------- */
CREATE TABLE plate_detections (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  lane_id            INT          NOT NULL,
  plate_raw          VARCHAR(20),                  -- chuỗi OCR đọc được, giữ nguyên
  plate_normalized   VARCHAR(15),                  -- đã chuẩn hóa để so khớp với vehicles
  vehicle_class      VARCHAR(20)  NULL,            -- loại xe do YOLO đoán (car, truck, bus...)
  confidence         DECIMAL(5,4),                 -- độ tin cậy 0.0000 - 1.0000
  image_path         VARCHAR(255),                 -- ảnh toàn cảnh
  plate_image_path   VARCHAR(255),                 -- ảnh crop riêng biển số
  detected_at        DATETIME(3)  NOT NULL,        -- (3) = độ chính xác mili giây
  processed          TINYINT(1)   NOT NULL DEFAULT 0,  -- 0 = chưa tính phí, 1 = đã xử lý
  INDEX idx_plate_time (plate_normalized, detected_at),
  INDEX idx_lane_time  (lane_id, detected_at),
  INDEX idx_processed  (processed, detected_at),
  FOREIGN KEY (lane_id) REFERENCES lanes(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   5. GIAO DỊCH THU PHÍ (mỗi lượt xe qua trạm)
   --------------------------------------------------------------------- */
CREATE TABLE toll_transactions (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  detection_id     BIGINT  NULL,                   -- lượt nhận diện gây ra giao dịch này
  vehicle_id       INT     NULL,                   -- NULL nếu xe lạ chưa đăng ký
  lane_id          INT     NOT NULL,
  vehicle_type_id  TINYINT NULL,                   -- NULL nếu chưa xác định được loại xe
  fee              BIGINT  NOT NULL,               -- số tiền phải thu tại thời điểm đó
  status           ENUM('paid','unpaid','manual_review','failed','exempt','refunded')
                   NOT NULL,
                   -- paid          : đã trừ ví thành công
                   -- unpaid        : ví không đủ tiền
                   -- manual_review : cần nhân viên kiểm tra (xe lạ, OCR kém tin cậy)
                   -- failed        : lỗi hệ thống
                   -- exempt        : được miễn phí / có vé tháng
                   -- refunded      : đã hoàn tiền
  passed_at        DATETIME(3) NOT NULL,           -- thời điểm xe qua trạm
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_detection (detection_id),          -- 1 lần nhận diện chỉ tính phí 1 lần
  INDEX idx_vehicle_time (vehicle_id, passed_at),
  INDEX idx_status (status),
  INDEX idx_passed_at (passed_at),
  FOREIGN KEY (detection_id)    REFERENCES plate_detections(id),
  FOREIGN KEY (vehicle_id)      REFERENCES vehicles(id),
  FOREIGN KEY (lane_id)         REFERENCES lanes(id),
  FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   6. VÍ, NẠP TIỀN, SỔ CÁI
   --------------------------------------------------------------------- */

-- Ví của khách. Mỗi khách đúng 1 ví. Tạo cùng lúc với customers khi đăng ký.
CREATE TABLE accounts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT    NOT NULL UNIQUE,
  balance      BIGINT NOT NULL DEFAULT 0,          -- số dư VNĐ
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_balance CHECK (balance >= 0),     -- không cho số dư âm (MySQL 8.0.16+)
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;

-- Đơn nạp tiền qua cổng thanh toán hoặc tại quầy.
CREATE TABLE payment_orders (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_code       VARCHAR(40) NOT NULL UNIQUE,    -- mã đơn gửi cho cổng thanh toán
  account_id       INT         NOT NULL,
  amount           BIGINT      NOT NULL,
  method           ENUM('vnpay','momo','bank_transfer','cash') NOT NULL,
  status           ENUM('pending','success','failed','cancelled','expired')
                   NOT NULL DEFAULT 'pending',
  gateway_txn_id   VARCHAR(100) NULL,              -- mã giao dịch phía cổng thanh toán
  gateway_payload  JSON NULL,                      -- lưu nguyên callback để đối soát sau này
  paid_at          DATETIME NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_po_account (account_id, created_at),
  INDEX idx_po_status  (status, created_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

-- Sổ cái ví: MỌI biến động số dư đều có 1 dòng ở đây (chỉ thêm, không sửa/xóa).
-- Đối soát: SUM(amount) của 1 ví phải bằng accounts.balance.
CREATE TABLE wallet_transactions (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT    NOT NULL,
  type            ENUM('topup','toll','refund','adjust') NOT NULL,
                  -- topup: nạp tiền | toll: trừ phí | refund: hoàn tiền | adjust: admin điều chỉnh
  amount          BIGINT NOT NULL,                 -- dương = cộng tiền, âm = trừ tiền
  balance_after   BIGINT NOT NULL,                 -- số dư ngay sau giao dịch
  ref_toll_id     BIGINT NULL,                     -- nếu là trừ phí: trỏ tới toll_transactions
  ref_payment_id  BIGINT NULL,                     -- nếu là nạp tiền: trỏ tới payment_orders
  note            VARCHAR(255),
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wt_account (account_id, created_at),
  -- Chống ghi trùng: 1 lượt qua trạm chỉ trừ ví 1 lần, 1 đơn nạp chỉ cộng 1 lần
  -- (callback cổng thanh toán gọi lại 2 lần cũng không cộng tiền 2 lần).
  UNIQUE KEY uq_toll_type    (ref_toll_id, type),
  UNIQUE KEY uq_payment_type (ref_payment_id, type),
  FOREIGN KEY (account_id)     REFERENCES accounts(id),
  FOREIGN KEY (ref_toll_id)    REFERENCES toll_transactions(id),
  FOREIGN KEY (ref_payment_id) REFERENCES payment_orders(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   7. MIỄN/GIẢM PHÍ, VÉ THÁNG
   Thứ tự kiểm tra khi tính phí:
     blacklist -> vé tháng còn hạn -> miễn/giảm -> mức phí thường -> trừ ví
   --------------------------------------------------------------------- */

-- Xe ưu tiên, xe công vụ, xe được giảm giá.
CREATE TABLE fee_exemptions (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id        INT     NOT NULL,
  discount_percent  TINYINT NOT NULL DEFAULT 100,  -- 100 = miễn hoàn toàn, 50 = giảm một nửa
  station_id        INT     NULL,                  -- NULL = áp dụng mọi trạm
  reason            VARCHAR(255),
  valid_from        DATE    NOT NULL,
  valid_to          DATE    NULL,                  -- NULL = không giới hạn
  CONSTRAINT chk_discount CHECK (discount_percent BETWEEN 1 AND 100),
  INDEX idx_fe_vehicle (vehicle_id, valid_from, valid_to),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (station_id) REFERENCES toll_stations(id)
) ENGINE=InnoDB;

-- Vé tháng / quý: xe có vé còn hạn thì qua trạm không bị trừ ví.
CREATE TABLE passes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id  INT    NOT NULL,
  station_id  INT    NOT NULL,
  price       BIGINT NOT NULL,                     -- giá đã bán
  valid_from  DATE   NOT NULL,
  valid_to    DATE   NOT NULL,
  status      ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  INDEX idx_pass_lookup (vehicle_id, valid_from, valid_to),
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (station_id) REFERENCES toll_stations(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   8. THỐNG KÊ & NHẬT KÝ
   --------------------------------------------------------------------- */

-- Bảng tổng hợp theo ngày, phục vụ dashboard/báo cáo cho nhanh.
-- Đừng COUNT/SUM trực tiếp trên toll_transactions mỗi lần mở trang.
-- Cập nhật bằng cron job hoặc:
--   INSERT ... ON DUPLICATE KEY UPDATE vehicle_count = vehicle_count + 1, ...
CREATE TABLE daily_station_stats (
  stat_date            DATE    NOT NULL,
  station_id           INT     NOT NULL,
  vehicle_type_id      TINYINT NOT NULL,
  vehicle_count        INT     NOT NULL DEFAULT 0,  -- tổng lượt xe
  paid_count           INT     NOT NULL DEFAULT 0,
  unpaid_count         INT     NOT NULL DEFAULT 0,
  manual_review_count  INT     NOT NULL DEFAULT 0,
  revenue              BIGINT  NOT NULL DEFAULT 0,  -- doanh thu VNĐ
  PRIMARY KEY (stat_date, station_id, vehicle_type_id),
  FOREIGN KEY (station_id)      REFERENCES toll_stations(id),
  FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types(id)
) ENGINE=InnoDB;

-- Nhật ký thao tác: ai làm gì, lúc nào, từ đâu. Dùng khi cần truy vết/khiếu nại.
-- Ví dụ: duyệt xe, điều chỉnh số dư, đổi biểu phí, khóa tài khoản.
CREATE TABLE audit_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NULL,                   -- NULL = hệ thống tự thực hiện
  action      VARCHAR(100) NOT NULL,               -- ví dụ: 'vehicle.approve', 'wallet.adjust'
  entity      VARCHAR(50)  NULL,                   -- tên bảng bị tác động
  entity_id   BIGINT       NULL,                   -- id dòng bị tác động
  detail      JSON,                                -- dữ liệu trước/sau khi đổi
  ip_address  VARCHAR(45)  NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_user_time (user_id, created_at),
  INDEX idx_audit_entity (entity, entity_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;


/* ---------------------------------------------------------------------
   9. DỮ LIỆU KHỞI TẠO (SEED)
   Chỉ là dữ liệu mẫu, hãy sửa cho đúng thực tế của bạn.
   --------------------------------------------------------------------- */

INSERT INTO vehicle_types (code, name) VALUES
  ('MOTORBIKE', 'Xe máy'),
  ('CAR_4',     'Xe con dưới 12 chỗ'),
  ('CAR_16',    'Xe 12-30 chỗ'),
  ('BUS',       'Xe khách trên 30 chỗ'),
  ('TRUCK_2T',  'Xe tải dưới 2 tấn'),
  ('TRUCK_10T', 'Xe tải 2-10 tấn'),
  ('CONTAINER', 'Xe container');

INSERT INTO toll_stations (code, name, location) VALUES
  ('TRAM01', 'Trạm thu phí số 1', 'Hà Nội');

INSERT INTO lanes (station_id, lane_no, direction) VALUES
  (1, 1, 'in'),
  (1, 2, 'out');

-- Biểu phí mẫu cho trạm 1 (VNĐ) - thay bằng mức phí thật
INSERT INTO toll_rates (station_id, vehicle_type_id, fee, effective_from) VALUES
  (1, 1,  5000, '2026-01-01'),
  (1, 2, 30000, '2026-01-01'),
  (1, 3, 50000, '2026-01-01'),
  (1, 4, 70000, '2026-01-01'),
  (1, 5, 60000, '2026-01-01'),
  (1, 6, 90000, '2026-01-01'),
  (1, 7, 150000, '2026-01-01');

-- Tài khoản admin đầu tiên: KHÔNG chèn mật khẩu ở đây.
-- Hãy tạo bằng Node.js: băm mật khẩu bằng bcrypt rồi INSERT, ví dụ:
--   INSERT INTO users (username, password_hash, full_name, role)
--   VALUES ('admin', '<chuỗi bcrypt>', 'Quản trị viên', 'admin');


/* ---------------------------------------------------------------------
   10. PHÂN QUYỀN USER MYSQL (không dùng root cho ứng dụng)
   Đổi 'mat_khau_manh' thành mật khẩu mạnh thật, rồi chạy bằng tài khoản root.
   --------------------------------------------------------------------- */

-- User cho Node.js (Express).
-- Không cấp DROP/ALTER. Không cấp DELETE trên bảng tiền để sổ cái không bị xóa.
CREATE USER IF NOT EXISTS 'its_app'@'localhost' IDENTIFIED BY 'mat_khau_manh';
GRANT SELECT, INSERT, UPDATE ON its_toll.* TO 'its_app'@'localhost';
-- Các bảng token cần xóa bản ghi hết hạn:
GRANT DELETE ON its_toll.refresh_tokens      TO 'its_app'@'localhost';
GRANT DELETE ON its_toll.verification_tokens TO 'its_app'@'localhost';

-- (Tùy chọn) User riêng cho Python nếu ghi thẳng DB: chỉ được thêm kết quả nhận diện.
-- Khuyến nghị hơn: Python gọi API POST /api/detections của Express.
-- CREATE USER IF NOT EXISTS 'its_ai'@'localhost' IDENTIFIED BY 'mat_khau_khac';
-- GRANT INSERT ON its_toll.plate_detections TO 'its_ai'@'localhost';

FLUSH PRIVILEGES;