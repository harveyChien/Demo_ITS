-- =====================================================================
-- ITS SMART TRAFFIC - DỮ LIỆU MẪU ĐẦY ĐỦ (v2 - dùng ID thực)
-- Lanes: 1,2,3 (trạm 1) | 10,11 (trạm 2) | 12,13 (trạm 3)
-- =====================================================================
USE its_toll;

SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM wallet_transactions;
DELETE FROM payment_orders;
DELETE FROM toll_transactions;
DELETE FROM plate_detections;
DELETE FROM devices;
DELETE FROM passes;
DELETE FROM fee_exemptions;
DELETE FROM vehicles;
DELETE FROM accounts;
DELETE FROM customers;
DELETE FROM verification_tokens;
DELETE FROM refresh_tokens;
DELETE FROM audit_logs;
DELETE FROM daily_station_stats;
DELETE FROM users WHERE role != 'admin';
ALTER TABLE customers AUTO_INCREMENT = 1;
ALTER TABLE vehicles AUTO_INCREMENT = 1;
ALTER TABLE accounts AUTO_INCREMENT = 1;
ALTER TABLE devices AUTO_INCREMENT = 1;
ALTER TABLE plate_detections AUTO_INCREMENT = 1;
ALTER TABLE toll_transactions AUTO_INCREMENT = 1;
ALTER TABLE wallet_transactions AUTO_INCREMENT = 1;
SET FOREIGN_KEY_CHECKS = 1;

-- Cập nhật trạm thu phí
INSERT INTO toll_stations (code, name, location, is_active) VALUES
  ('TRAM01', 'Trạm thu phí Nội Bài',    'Quốc lộ 2, Hà Nội',             1),
  ('TRAM02', 'Trạm thu phí Pháp Vân',   'Quốc lộ 1A, Hà Nội',            1),
  ('TRAM03', 'Trạm thu phí Cầu Giẽ',    'Cao tốc Pháp Vân – Cầu Giẽ',    1)
ON DUPLICATE KEY UPDATE name = VALUES(name), location = VALUES(location);

-- Biểu phí cho tất cả trạm
INSERT INTO toll_rates (station_id, vehicle_type_id, fee, effective_from) VALUES
  (1,1,5000,'2026-01-01'),(1,2,35000,'2026-01-01'),(1,3,55000,'2026-01-01'),
  (1,4,75000,'2026-01-01'),(1,5,65000,'2026-01-01'),(1,6,95000,'2026-01-01'),(1,7,160000,'2026-01-01'),
  (2,1,5000,'2026-01-01'),(2,2,30000,'2026-01-01'),(2,3,50000,'2026-01-01'),
  (2,4,70000,'2026-01-01'),(2,5,60000,'2026-01-01'),(2,6,90000,'2026-01-01'),(2,7,150000,'2026-01-01'),
  (3,1,4000,'2026-01-01'),(3,2,25000,'2026-01-01'),(3,3,45000,'2026-01-01'),
  (3,4,65000,'2026-01-01'),(3,5,55000,'2026-01-01'),(3,6,80000,'2026-01-01'),(3,7,140000,'2026-01-01')
ON DUPLICATE KEY UPDATE fee = VALUES(fee);

-- Thiết bị (dùng lane ID thực: 1,2,3,10,11,12,13)
INSERT INTO devices (lane_id, type, name, status, last_seen_at) VALUES
  (1,  'camera',      'CAM-01-IN',      'online',      NOW()),
  (1,  'barrier',     'BARRIER-01-IN',  'online',      NOW()),
  (1,  'rfid_reader', 'RFID-01-IN',     'online',      NOW()),
  (2,  'camera',      'CAM-01-OUT',     'online',      NOW()),
  (2,  'barrier',     'BARRIER-01-OUT', 'online',      NOW()),
  (3,  'camera',      'CAM-01-BOTH',    'offline',     NOW() - INTERVAL 2 HOUR),
  (10, 'camera',      'CAM-02-IN',      'online',      NOW()),
  (10, 'barrier',     'BARRIER-02-IN',  'online',      NOW()),
  (10, 'rfid_reader', 'RFID-02-IN',     'online',      NOW()),
  (11, 'camera',      'CAM-02-OUT',     'online',      NOW()),
  (11, 'barrier',     'BARRIER-02-OUT', 'maintenance', NOW() - INTERVAL 30 MINUTE),
  (12, 'camera',      'CAM-03-1',       'online',      NOW()),
  (12, 'rfid_reader', 'RFID-03-1',      'online',      NOW()),
  (13, 'camera',      'CAM-03-2',       'online',      NOW());

-- Users khách hàng mẫu (password hash = 'Demo@123456')
INSERT INTO users (username, email, password_hash, full_name, role, is_active, email_verified_at) VALUES
  (NULL,'nguyen.van.an@gmail.com',   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Nguyễn Văn An',   'customer',1,NOW()),
  (NULL,'tran.thi.bich@gmail.com',   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Trần Thị Bích',   'customer',1,NOW()),
  (NULL,'le.van.cuong@gmail.com',    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Lê Văn Cường',    'customer',1,NOW()),
  (NULL,'pham.thi.dung@gmail.com',   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Phạm Thị Dung',   'customer',1,NOW()),
  (NULL,'hoang.van.em@gmail.com',    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Hoàng Văn Em',    'customer',1,NOW()),
  (NULL,'vu.thi.phuong@gmail.com',   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Vũ Thị Phương',   'customer',1,NOW()),
  (NULL,'do.van.giang@gmail.com',    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Đỗ Văn Giang',    'customer',1,NOW()),
  (NULL,'bui.thi.huong@gmail.com',   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Bùi Thị Hương',   'customer',1,NOW()),
  (NULL,'duong.van.khanh@gmail.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Dương Văn Khánh', 'customer',1,NOW()),
  (NULL,'ngo.thi.lan@gmail.com',     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMUBufQK.kSXOZHs.HuHj0TKHG','Ngô Thị Lan',     'customer',1,NOW());

-- Customers
INSERT INTO customers (user_id, full_name, phone, email, id_number)
SELECT u.id,
  u.full_name,
  CONCAT('090123', LPAD((ROW_NUMBER() OVER (ORDER BY u.id)), 4, '0')),
  u.email,
  CONCAT('00108600', LPAD((ROW_NUMBER() OVER (ORDER BY u.id) + 1233), 4, '0'))
FROM users u WHERE u.role = 'customer';

-- Accounts (ví ETC)
INSERT INTO accounts (customer_id, balance)
SELECT c.id,
  ELT(((c.id - 1) % 10) + 1, 2500000, 1200000, 800000, 5000000, 350000, 75000, 3000000, 1800000, 620000, 4200000)
FROM customers c;

-- Phương tiện (plate_normalized phải UNIQUE)
INSERT INTO vehicles (customer_id, vehicle_type_id, plate_normalized, plate_display, status, approved_at)
SELECT
  c.id,
  ELT(((c.id-1) % 7)+1, 2, 2, 1, 3, 2, 5, 2),
  CONCAT(
    ELT(((c.id-1) % 5)+1, '29', '30', '31', '33', '51'),
    ELT(((c.id-1) % 4)+1, 'A', 'B', 'C', 'D'),
    LPAD(c.id * 12345 % 90000 + 10000, 5, '0')
  ),
  CONCAT(
    ELT(((c.id-1) % 5)+1, '29', '30', '31', '33', '51'),
    ELT(((c.id-1) % 4)+1, 'A', 'B', 'C', 'D'),
    '-',
    LPAD((c.id * 12345 % 90000 + 10000) DIV 100, 3, '0'),
    '.',
    LPAD(c.id * 12345 % 90000 + 10000 - ((c.id * 12345 % 90000 + 10000) DIV 100)*100, 2, '0')
  ),
  CASE WHEN c.id = 5 THEN 'pending' WHEN c.id = 9 THEN 'inactive' ELSE 'active' END,
  NOW()
FROM customers c;

-- Xe thứ 2 cho khách hàng 1
INSERT INTO vehicles (customer_id, vehicle_type_id, plate_normalized, plate_display, status, approved_at)
SELECT c.id, 5, CONCAT('29T', LPAD(c.id*999+1111,5,'0')), CONCAT('29T-', LPAD(c.id*999+1111,5,'0')), 'active', NOW()
FROM customers c WHERE c.id = 1;

-- ─── Nhận diện biển số (plate_detections) – dùng biến để lấy plate từ vehicle
-- Nhận diện trong 7 ngày qua
INSERT INTO plate_detections (lane_id, plate_raw, plate_normalized, vehicle_class, confidence, detected_at, processed)
SELECT
  CASE d.rn % 7
    WHEN 0 THEN 1  WHEN 1 THEN 2  WHEN 2 THEN 10
    WHEN 3 THEN 11 WHEN 4 THEN 12 WHEN 5 THEN 13 WHEN 6 THEN 1
  END AS lane_id,
  v.plate_display  AS plate_raw,
  v.plate_normalized,
  ELT((v.id % 5)+1,'car','car','motorbike','truck','van') AS vehicle_class,
  ROUND(0.85 + (v.id * 7 % 14) * 0.01, 4)           AS confidence,
  NOW() - INTERVAL (d.rn * 25) MINUTE               AS detected_at,
  1                                                   AS processed
FROM vehicles v
JOIN (SELECT 0 rn UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) d ON 1=1
WHERE v.status = 'active'
ORDER BY v.id, d.rn;

-- Thêm detection mới nhất (chưa xử lý) để hiển thị trong camera panel
INSERT INTO plate_detections (lane_id, plate_raw, plate_normalized, vehicle_class, confidence, detected_at, processed)
SELECT 1, v.plate_display, v.plate_normalized, 'car', 0.9821, NOW() - INTERVAL 90 SECOND, 0
FROM vehicles v WHERE v.status = 'active' ORDER BY v.id DESC LIMIT 1;

-- Detection xe lạ
INSERT INTO plate_detections (lane_id, plate_raw, plate_normalized, vehicle_class, confidence, detected_at, processed)
VALUES (10, 'BKS-NGOAI', 'BKSNGOAI', 'truck', 0.6512, NOW() - INTERVAL 5 MINUTE, 0);

-- ─── Giao dịch thu phí
-- Tạo giao dịch cho từng vehicle trong 7 ngày
INSERT INTO toll_transactions (vehicle_id, lane_id, vehicle_type_id, fee, status, passed_at)
SELECT
  v.id,
  CASE ((v.id + d.rn) % 7)
    WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 10
    WHEN 3 THEN 11 WHEN 4 THEN 12 WHEN 5 THEN 13 WHEN 6 THEN 1
  END,
  v.vehicle_type_id,
  CASE v.vehicle_type_id
    WHEN 1 THEN 5000  WHEN 2 THEN 35000 WHEN 3 THEN 55000
    WHEN 4 THEN 75000 WHEN 5 THEN 65000 WHEN 6 THEN 95000 ELSE 25000
  END AS fee,
  CASE WHEN (v.id + d.rn) % 8 = 0 THEN 'unpaid'
       WHEN (v.id + d.rn) % 12 = 0 THEN 'manual_review'
       ELSE 'paid' END AS status,
  NOW() - INTERVAL (d.rn * 18 + v.id) HOUR AS passed_at
FROM vehicles v
JOIN (SELECT 0 rn UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4) d ON 1=1
WHERE v.status = 'active';

-- ─── Ví (wallet_transactions) – ghi sổ cái cho mỗi giao dịch paid
INSERT INTO wallet_transactions (account_id, type, amount, balance_after, ref_toll_id, note, created_at)
SELECT
  a.id,
  'toll',
  -t.fee,
  a.balance - SUM(t.fee) OVER (PARTITION BY a.id ORDER BY t.passed_at ROWS UNBOUNDED PRECEDING),
  t.id,
  CONCAT('Phí qua trạm ', ts.name),
  t.passed_at
FROM toll_transactions t
JOIN vehicles v ON v.id = t.vehicle_id
JOIN customers c ON c.id = v.customer_id
JOIN accounts a ON a.customer_id = c.id
JOIN lanes l ON l.id = t.lane_id
JOIN toll_stations ts ON ts.id = l.station_id
WHERE t.status = 'paid';

-- Nạp tiền mẫu
INSERT INTO wallet_transactions (account_id, type, amount, balance_after, note, created_at) VALUES
  (1, 'topup', 1000000, 2500000, 'Nạp tiền qua VNPAY', NOW() - INTERVAL 15 DAY),
  (2, 'topup', 500000,  1200000, 'Nạp tiền tại quầy',  NOW() - INTERVAL 10 DAY),
  (4, 'topup', 2000000, 5000000, 'Nạp tiền qua VNPAY', NOW() - INTERVAL 7 DAY),
  (7, 'topup', 3000000, 3000000, 'Nạp tiền tại quầy',  NOW() - INTERVAL 3 DAY);

-- ─── Thống kê hàng ngày
INSERT INTO daily_station_stats (stat_date, station_id, vehicle_type_id, vehicle_count, paid_count, revenue)
VALUES
  (CURRENT_DATE()-INTERVAL 6 DAY,1,2,18,16,560000),
  (CURRENT_DATE()-INTERVAL 5 DAY,1,2,22,20,700000),
  (CURRENT_DATE()-INTERVAL 5 DAY,2,2,14,13,390000),
  (CURRENT_DATE()-INTERVAL 4 DAY,1,2,25,23,805000),
  (CURRENT_DATE()-INTERVAL 3 DAY,1,2,19,18,630000),
  (CURRENT_DATE()-INTERVAL 2 DAY,1,2,28,26,910000),
  (CURRENT_DATE()-INTERVAL 1 DAY,1,2,21,21,735000),
  (CURRENT_DATE(),               1,2,12, 10,350000)
ON DUPLICATE KEY UPDATE vehicle_count=vehicle_count+VALUES(vehicle_count), revenue=revenue+VALUES(revenue);

-- Kết quả
SELECT 'OK - Seed loaded!' AS status;
SELECT COUNT(*) AS users    FROM users;
SELECT COUNT(*) AS customers FROM customers;
SELECT COUNT(*) AS vehicles FROM vehicles;
SELECT COUNT(*) AS detections FROM plate_detections;
SELECT COUNT(*) AS transactions FROM toll_transactions;
SELECT COUNT(*) AS wallet_tx FROM wallet_transactions;

