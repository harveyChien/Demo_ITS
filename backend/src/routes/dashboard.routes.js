import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

export const dashboardRouter = Router();
const routeDirectory = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.resolve(routeDirectory, "../uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const accepted = file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
    callback(accepted ? null : new Error("Chỉ hỗ trợ tệp hình ảnh hoặc video."), accepted);
  },
});

const DEMO_LANE_RECOGNITIONS = [
  { plate: "30E88888", display: "30E-888.88", laneNo: 2, balance: 465000, result: "paid", message: "Cho qua: da tru 35.000 VNĐ, barrier nang." },
  { plate: "29A12345", display: "29A-123.45", laneNo: 1, balance: 15000, result: "unpaid", message: "Khong qua: so du khong du, vui long nap them." },
  { plate: "51K99999", display: "51K-999.99", laneNo: 3, result: "manual_review", message: "Khong qua: bien so chua dang ky, can xu ly thu cong." },
];

async function processDemoRecognition(connection, relativePath) {
  const [[station]] = await connection.query("SELECT id FROM toll_stations ORDER BY id LIMIT 1");
  const [[carType]] = await connection.query("SELECT id FROM vehicle_types WHERE code = 'CAR_4' LIMIT 1");
  if (!station || !carType) throw new Error("Thieu tram hoac loai xe CAR_4 de chay demo.");
  const result = [];

  for (const item of DEMO_LANE_RECOGNITIONS) {
    let [[lane]] = await connection.query("SELECT id FROM lanes WHERE station_id = ? AND lane_no = ? LIMIT 1", [station.id, item.laneNo]);
    if (!lane) {
      const [laneInsert] = await connection.query(
        "INSERT INTO lanes (station_id, lane_no, direction) VALUES (?, ?, 'in')",
        [station.id, item.laneNo],
      );
      lane = { id: laneInsert.insertId };
    }

    let vehicleId = null;
    let accountId = null;
    if (item.plate !== "51K99999") {
      const [[existingVehicle]] = await connection.query(
        "SELECT v.id, a.id AS accountId FROM vehicles v JOIN customers c ON c.id = v.customer_id LEFT JOIN accounts a ON a.customer_id = c.id WHERE v.plate_normalized = ? LIMIT 1",
        [item.plate],
      );
      if (existingVehicle) {
        vehicleId = existingVehicle.id;
        accountId = existingVehicle.accountId;
      } else {
        const [customerInsert] = await connection.query(
          "INSERT INTO customers (full_name, phone, email) VALUES (?, ?, ?)",
          [`Demo ${item.display}`, null, `demo-${item.plate.toLowerCase()}@example.test`],
        );
        const [vehicleInsert] = await connection.query(
          "INSERT INTO vehicles (customer_id, vehicle_type_id, plate_normalized, plate_display, status) VALUES (?, ?, ?, ?, 'active')",
          [customerInsert.insertId, carType.id, item.plate, item.display],
        );
        const [accountInsert] = await connection.query(
          "INSERT INTO accounts (customer_id, balance) VALUES (?, ?)",
          [customerInsert.insertId, item.balance],
        );
        vehicleId = vehicleInsert.insertId;
        accountId = accountInsert.insertId;
      }
    }

    const [detectionInsert] = await connection.query(
      `INSERT INTO plate_detections
        (lane_id, plate_raw, plate_normalized, vehicle_class, confidence, image_path, detected_at, processed)
       VALUES (?, ?, ?, 'car', 0.9900, ?, NOW(3), 1)`,
      [lane.id, item.display, item.plate, relativePath],
    );
    const fee = 35000;
    const status = item.result;
    const [transactionInsert] = await connection.query(
      `INSERT INTO toll_transactions
        (detection_id, vehicle_id, lane_id, vehicle_type_id, fee, status, passed_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
      [detectionInsert.insertId, vehicleId, lane.id, vehicleId ? carType.id : null, fee, status],
    );

    let balanceAfter = null;
    if (status === "paid" && accountId) {
      const [[account]] = await connection.query("SELECT balance FROM accounts WHERE id = ? FOR UPDATE", [accountId]);
      balanceAfter = Number(account.balance) - fee;
      await connection.query("UPDATE accounts SET balance = ? WHERE id = ?", [balanceAfter, accountId]);
      await connection.query(
        "INSERT INTO wallet_transactions (account_id, type, amount, balance_after, ref_toll_id, note) VALUES (?, 'toll', ?, ?, ?, ?)",
        [accountId, -fee, balanceAfter, transactionInsert.insertId, `Demo camera: ${item.display}`],
      );
    }
    result.push({ plate: item.display, laneNo: item.laneNo, status, fee, balanceAfter, message: item.message });
  }
  return result;
}

/* ─── Upload media ─── */
dashboardRouter.post("/upload", (request, response, next) => {
  upload.single("media")(request, response, async (error) => {
    if (error) return response.status(400).json({ message: error.message });
    if (!request.file) return response.status(400).json({ message: "Vui lòng chọn ảnh hoặc video để tải lên." });
    try {
      const [[lane]] = await pool.query("SELECT id FROM lanes WHERE is_active = 1 ORDER BY id LIMIT 1");
      if (!lane) {
        fs.unlinkSync(request.file.path);
        return response.status(409).json({ message: "Chưa có làn thu phí hoạt động để ghi nhận tệp." });
      }
      const relativePath = `/uploads/${request.file.filename}`;
      const [result] = await pool.query(`
        INSERT INTO plate_detections
          (lane_id, image_path, detected_at, processed)
        VALUES (?, ?, NOW(3), 0)`,
        [lane.id, relativePath],
      );
      const isDemoImage = process.env.DEMO_RECOGNITION === "true"
        || /etc_tram_thu_phi_bien_so_ro|30e[-_]?888/i.test(request.file.originalname);
      if (isDemoImage) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          const recognitionResults = await processDemoRecognition(connection, relativePath);
          await connection.commit();
          return response.status(201).json({
            message: "Da nhan dien demo 3 lan va xu ly giao dich.",
            detectionId: result.insertId,
            recognitionResults,
            file: { name: request.file.originalname, type: request.file.mimetype, url: relativePath, size: request.file.size },
            status: "processed",
          });
        } catch (demoError) {
          await connection.rollback();
          return next(demoError);
        } finally {
          connection.release();
        }
      }
      return response.status(201).json({
        message: "Đã tải tệp lên. Hệ thống AI đang chờ xử lý nhận diện.",
        detectionId: result.insertId,
        file: { name: request.file.originalname, type: request.file.mimetype, url: relativePath, size: request.file.size },
        status: "queued",
      });
    } catch (databaseError) {
      fs.unlinkSync(request.file.path);
      return next(databaseError);
    }
  });
});

/* ─── User dashboard ─── */
dashboardRouter.get("/user/:userId", async (request, response) => {
  const userId = Number(request.params.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    return response.status(400).json({ message: "Mã tài khoản không hợp lệ." });
  }
  try {
    const [[profile]] = await pool.query(`
      SELECT u.id, u.full_name AS fullName, u.email, c.phone, c.id_number AS idNumber,
        a.id AS accountId, COALESCE(a.balance, 0) AS balance
      FROM users u
      LEFT JOIN customers c ON c.user_id = u.id
      LEFT JOIN accounts a ON a.customer_id = c.id
      WHERE u.id = ? AND u.role = 'customer' LIMIT 1`, [userId]);
    if (!profile) return response.status(404).json({ message: "Không tìm thấy thông tin User." });
    const [vehicles] = await pool.query(`
      SELECT v.id, COALESCE(v.plate_display, v.plate_normalized, '') AS plate,
        COALESCE(vt.name, 'Chưa xác định') AS vehicleType, v.status
      FROM vehicles v LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      JOIN customers c ON c.id = v.customer_id WHERE c.user_id = ? ORDER BY v.created_at DESC`, [userId]);
    const [walletTransactions] = await pool.query(`
      SELECT wt.id, wt.type, wt.amount, wt.balance_after AS balanceAfter,
        COALESCE(wt.note, '') AS note, DATE_FORMAT(wt.created_at, '%d/%m/%Y %H:%i') AS createdAt,
        COALESCE(ts.name, CASE WHEN wt.type = 'topup' THEN 'Nạp tiền ví' ELSE 'Điều chỉnh ví' END) AS location
      FROM wallet_transactions wt
      JOIN accounts a ON a.id = wt.account_id
      LEFT JOIN toll_transactions tt ON tt.id = wt.ref_toll_id
      LEFT JOIN lanes l ON l.id = tt.lane_id
      LEFT JOIN toll_stations ts ON ts.id = l.station_id
      WHERE a.id = ? ORDER BY wt.created_at DESC LIMIT 20`, [profile.accountId || 0]);
    const [passages] = await pool.query(`
      SELECT DATE_FORMAT(tt.passed_at, '%d/%m/%Y %H:%i') AS passedAt,
        COALESCE(ts.name, 'Chưa xác định') AS station, l.lane_no AS laneNo,
        COALESCE(v.plate_display, v.plate_normalized, 'Xe chưa đăng ký') AS plate,
        tt.fee, tt.status
      FROM toll_transactions tt
      LEFT JOIN vehicles v ON v.id = tt.vehicle_id
      LEFT JOIN lanes l ON l.id = tt.lane_id
      LEFT JOIN toll_stations ts ON ts.id = l.station_id
      LEFT JOIN customers c ON c.id = v.customer_id
      WHERE c.user_id = ? ORDER BY tt.passed_at DESC LIMIT 20`, [userId]);
    const notifications = [];
    if (Number(profile.balance) < 100000) notifications.push({ type: "warning", title: "Số dư tài khoản thấp", text: "Vui lòng nạp thêm tiền để lưu thông thông suốt." });
    passages.slice(0, 3).forEach((item) => notifications.push({ type: "success", title: "Qua trạm thành công", text: `${item.plate} · ${item.station} · ${Number(item.fee).toLocaleString("vi-VN")} VNĐ` }));
    const [vehicleTypes] = await pool.query("SELECT id, code, name FROM vehicle_types ORDER BY id");
    return response.json({ profile, vehicles, vehicleTypes, walletTransactions, passages, notifications });
  } catch (error) {
    console.error("User dashboard query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải thông tin tài khoản User." });
  }
});

dashboardRouter.post("/user/:userId/vehicles", async (request, response) => {
  const userId = Number(request.params.userId);
  const { plate, vehicleTypeId } = request.body;
  if (!Number.isInteger(userId) || userId < 1 || !plate || !Number.isInteger(Number(vehicleTypeId))) {
    return response.status(400).json({ message: "Biển số và loại xe là bắt buộc." });
  }
  try {
    const [[customer]] = await pool.query(`
      SELECT c.id, c.full_name AS fullName FROM customers c
      JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ? AND u.role = 'customer' LIMIT 1`, [userId]);
    if (!customer) return response.status(404).json({ message: "Không tìm thấy thông tin User." });
    const plateNormalized = String(plate).toUpperCase().replace(/[\s\-\.]/g, "");
    const plateDisplay = String(plate).toUpperCase().trim();
    const [[existing]] = await pool.query("SELECT id FROM vehicles WHERE plate_normalized = ? LIMIT 1", [plateNormalized]);
    if (existing) return response.status(409).json({ message: "Biển số xe này đã được đăng ký." });
    await pool.query(
      "INSERT INTO vehicles (customer_id, vehicle_type_id, plate_normalized, plate_display, status) VALUES (?, ?, ?, ?, 'pending')",
      [customer.id, Number(vehicleTypeId), plateNormalized, plateDisplay],
    );
    return response.status(201).json({ message: "Đã gửi đăng ký thông tin xe." });
  } catch (error) {
    console.error("User vehicle registration failed:", error.message);
    return response.status(500).json({ message: "Không thể đăng ký thông tin xe." });
  }
});

dashboardRouter.post("/user/:userId/payment-orders", async (request, response) => {
  const userId = Number(request.params.userId);
  const amount = Number(request.body.amount);
  const { method, bank, bankDetails = {} } = request.body;
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(amount) || amount < 10000) {
    return response.status(400).json({ message: "Số tiền nạp tối thiểu là 10.000 VNĐ." });
  }
  if (!["vnpay", "momo"].includes(method) || (method === "vnpay" && !bank)) {
    return response.status(400).json({ message: "Vui lòng chọn cổng thanh toán và ngân hàng." });
  }
  if (!bankDetails.accountName || !bankDetails.accountNumber) {
    return response.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin thanh toán demo." });
  }
  try {
    const [[account]] = await pool.query(`
      SELECT a.id FROM accounts a
      JOIN customers c ON c.id = a.customer_id
      JOIN users u ON u.id = c.user_id
      WHERE u.id = ? AND u.role = 'customer' LIMIT 1`, [userId]);
    if (!account) return response.status(404).json({ message: "Không tìm thấy ví của người dùng." });
    const orderCode = `${method.toUpperCase()}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await pool.query(
      "INSERT INTO payment_orders (order_code, account_id, amount, method, gateway_payload) VALUES (?, ?, ?, ?, ?)",
      [orderCode, account.id, amount, method, JSON.stringify({
        bank: bank || null,
        demoPaymentDetails: {
          accountName: String(bankDetails.accountName).trim(),
          accountNumber: String(bankDetails.accountNumber).replace(/\D/g, ""),
          branch: String(bankDetails.branch || "").trim(),
        },
      })],
    );
    const gatewayConfigured = method === "vnpay"
      ? Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET)
      : Boolean(process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY);
    const checkoutUrl = method === "vnpay" ? process.env.VNPAY_PAYMENT_URL : process.env.MOMO_PAYMENT_URL;
    return response.status(201).json({
      orderCode,
      status: "pending",
      gatewayConfigured,
      checkoutUrl: gatewayConfigured ? checkoutUrl : null,
      message: gatewayConfigured ? "Đã tạo đơn sandbox." : "Đơn đã lưu; cần điền credentials sandbox để tạo URL thanh toán.",
    });
  } catch (error) {
    console.error("Payment order creation failed:", error.message);
    return response.status(500).json({ message: "Không thể tạo đơn nạp tiền." });
  }
});

dashboardRouter.get("/payments/gateways/status", (_request, response) => {
  response.json({
    vnpay: {
      configured: Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET),
      paymentUrl: process.env.VNPAY_PAYMENT_URL || null,
      callbackConfigured: Boolean(process.env.VNPAY_RETURN_URL && process.env.VNPAY_IPN_URL),
    },
    momo: {
      configured: Boolean(process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY),
      paymentUrl: process.env.MOMO_PAYMENT_URL || null,
      callbackConfigured: Boolean(process.env.MOMO_RETURN_URL && process.env.MOMO_IPN_URL),
    },
  });
});

function vnpayCallback(request, response) {
  if (!process.env.VNPAY_TMN_CODE || !process.env.VNPAY_HASH_SECRET) {
    return response.status(503).json({ message: "VNPay sandbox chưa được cấu hình." });
  }
  return response.status(501).json({ message: "VNPay callback đang chờ triển khai xác thực chữ ký." });
}
dashboardRouter.all("/payments/vnpay/return", vnpayCallback);
dashboardRouter.all("/payments/vnpay/ipn", vnpayCallback);

function momoCallback(request, response) {
  if (!process.env.MOMO_PARTNER_CODE || !process.env.MOMO_ACCESS_KEY || !process.env.MOMO_SECRET_KEY) {
    return response.status(503).json({ message: "MoMo sandbox chưa được cấu hình." });
  }
  return response.status(501).json({ message: "MoMo callback đang chờ triển khai xác thực chữ ký." });
}
dashboardRouter.all("/payments/momo/return", momoCallback);
dashboardRouter.all("/payments/momo/ipn", momoCallback);

/* ─── Dashboard chính (admin overview) ─── */
dashboardRouter.get("/", async (_request, response) => {
  try {
    const [[live]] = await pool.query(`
      SELECT ts.name AS stationName, l.lane_no AS laneNo,
        COALESCE(d.status, 'offline') AS deviceStatus,
        COALESCE(barrier.status, 'offline') AS barrierStatus,
        COALESCE(pd.plate_raw, pd.plate_normalized, '') AS plate,
        COALESCE(pd.vehicle_class, '') AS vehicleClass,
        COALESCE(CONCAT(ROUND(pd.confidence * 100, 1), '%'), '--') AS confidence,
        COALESCE(DATE_FORMAT(pd.detected_at, '%d/%m/%Y %H:%i:%s'), '--') AS detectedAt,
        COALESCE(pd.image_path, '') AS imagePath
      FROM lanes l
      JOIN toll_stations ts ON ts.id = l.station_id
      LEFT JOIN devices d ON d.lane_id = l.id AND d.type = 'camera'
      LEFT JOIN devices barrier ON barrier.lane_id = l.id AND barrier.type = 'barrier'
      LEFT JOIN plate_detections pd ON pd.lane_id = l.id
      ORDER BY pd.detected_at DESC, l.id
      LIMIT 1`);
    const [recentDetections] = await pool.query(`
      SELECT COALESCE(plate_raw, plate_normalized, '') AS plate,
        COALESCE(vehicle_class, '') AS vehicleClass,
        COALESCE(CONCAT(ROUND(confidence * 100, 1), '%'), '--') AS confidence,
        DATE_FORMAT(detected_at, '%d/%m/%Y %H:%i:%s') AS detectedAt
      FROM plate_detections ORDER BY detected_at DESC LIMIT 5`);
    const [registeredVehicles] = await pool.query(`
      SELECT COALESCE(v.plate_display, v.plate_normalized, '') AS plate,
        COALESCE(c.full_name, 'Chưa cập nhật') AS owner,
        COALESCE(vt.name, 'Chưa xác định') AS vehicleType, v.status
      FROM vehicles v JOIN customers c ON c.id = v.customer_id
      LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      ORDER BY v.created_at DESC LIMIT 6`);
    const [transactions] = await pool.query(`
      SELECT COALESCE(v.plate_display, v.plate_normalized, 'Xe chưa đăng ký') AS plate,
        COALESCE(c.full_name, 'Chưa cập nhật') AS owner, t.fee, t.status,
        DATE_FORMAT(t.passed_at, '%H:%i:%s') AS passedAt
      FROM toll_transactions t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN customers c ON c.id = v.customer_id
      ORDER BY t.passed_at DESC LIMIT 6`);
    const [[todayDetections]] = await pool.query(
      "SELECT COUNT(*) AS total FROM plate_detections WHERE DATE(detected_at) = CURRENT_DATE()",
    );
    const [[vehicleCount]] = await pool.query("SELECT COUNT(*) AS total FROM vehicles");
    const [[revenue]] = await pool.query("SELECT COALESCE(SUM(fee), 0) AS total FROM toll_transactions WHERE status = 'paid'");
    const [[alertCount]] = await pool.query("SELECT COUNT(*) AS total FROM toll_transactions WHERE status IN ('unpaid','manual_review','failed')");
    const [[etcStats]] = await pool.query(`
      SELECT COUNT(v.id) AS totalVehicles,
        COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN v.id END) AS etcVehicles,
        COUNT(DISTINCT a.id) AS accounts
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      LEFT JOIN accounts a ON a.customer_id = c.id`);
    const [laneStatus] = await pool.query(`
      SELECT l.lane_no AS laneNo,
        CASE WHEN EXISTS (
          SELECT 1 FROM devices rfid WHERE rfid.lane_id = l.id AND rfid.type = 'rfid_reader'
        ) THEN 'ETC' ELSE 'Hỗn hợp' END AS laneType,
        COALESCE(d.status, 'offline') AS deviceStatus,
        COUNT(DISTINCT CASE WHEN DATE(tt.passed_at) = CURRENT_DATE() THEN tt.id END) AS vehicleCount
      FROM lanes l
      LEFT JOIN devices d ON d.lane_id = l.id AND d.type = 'camera'
      LEFT JOIN toll_transactions tt ON tt.lane_id = l.id
      GROUP BY l.id, l.lane_no, d.status
      ORDER BY l.lane_no LIMIT 8`);
    const [dailyStats] = await pool.query(`
      SELECT DATE_FORMAT(day_value, '%d/%m') AS day, vehicleCount, revenue
      FROM (
        SELECT DATE(passed_at) AS day_value, COUNT(*) AS vehicleCount,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN fee ELSE 0 END), 0) AS revenue
        FROM toll_transactions
        WHERE passed_at >= CURRENT_DATE() - INTERVAL 6 DAY
        GROUP BY DATE(passed_at)
      ) daily ORDER BY day_value`);
    const [vehicleClasses] = await pool.query(`
      SELECT COALESCE(vt.name, 'Chưa xác định') AS vehicleType, COUNT(*) AS total
      FROM vehicles v LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      GROUP BY vt.id, vt.name ORDER BY total DESC`);
    return response.json({
      generatedAt: new Date().toLocaleString("vi-VN"),
      live: {
        stationName: live?.stationName || "Chưa có trạm",
        laneNo: live?.laneNo || "--",
        deviceStatus: live?.deviceStatus === "online" ? "ĐANG ONLINE" : "OFFLINE",
        plate: live?.plate || "",
        vehicleClass: live?.vehicleClass || "",
        confidence: live?.confidence || "--",
        detectedAt: live?.detectedAt || "--",
        imagePath: live?.imagePath || "",
        barrierStatus: live?.barrierStatus === "online" ? "ĐANG MỞ" : "OFFLINE",
      },
      recentDetections, registeredVehicles, transactions,
      alerts: Number(alertCount.total || 0),
      laneStatus: laneStatus.map((lane) => ({
        laneNo: lane.laneNo,
        laneType: lane.laneType,
        deviceStatus: lane.deviceStatus === "online" ? "Hoạt động" : "Bảo trì",
        vehicleCount: Number(lane.vehicleCount || 0),
      })),
      dailyStats: dailyStats.map((item) => ({
        day: item.day,
        vehicleCount: Number(item.vehicleCount || 0),
        revenue: Number(item.revenue || 0),
      })),
      vehicleClasses: vehicleClasses.map((item) => ({
        vehicleType: item.vehicleType,
        total: Number(item.total || 0),
      })),
      summary: [
        { label: "Tổng số xe qua trạm", value: Number(todayDetections.total || 0).toLocaleString("vi-VN"), note: "Hôm nay", color: "blue" },
        { label: "Tổng doanh thu", value: `${Number(revenue.total || 0).toLocaleString("vi-VN")} VNĐ`, note: "Đã thanh toán", color: "green" },
        { label: "Xe ETC (%)", value: `${Number(etcStats.totalVehicles || 0) ? ((Number(etcStats.etcVehicles || 0) / Number(etcStats.totalVehicles)) * 100).toFixed(1) : "0"}%`, note: `${Number(etcStats.etcVehicles || 0).toLocaleString("vi-VN")} xe đã liên kết`, color: "purple" },
        { label: "Tài khoản ETC", value: Number(etcStats.accounts || 0).toLocaleString("vi-VN"), note: `${Number(vehicleCount.total || 0).toLocaleString("vi-VN")} phương tiện đăng ký`, color: "orange" },
      ],
    });
  } catch (error) {
    console.error("Dashboard query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải dữ liệu dashboard từ MySQL." });
  }
});

/* ─── Vehicles (quản lý phương tiện) ─── */
dashboardRouter.get("/vehicles", async (request, response) => {
  const { search = "", status = "", page = 1, limit = 20 } = request.query;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    let where = "WHERE 1=1";
    const params = [];
    if (search) { where += " AND (v.plate_display LIKE ? OR v.plate_normalized LIKE ? OR c.full_name LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where += " AND v.status = ?"; params.push(status); }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM vehicles v JOIN customers c ON c.id = v.customer_id ${where}`,
      params,
    );
    const [rows] = await pool.query(`
      SELECT v.id, COALESCE(v.plate_display, v.plate_normalized, '') AS plate,
        v.plate_normalized, v.status, v.created_at,
        COALESCE(c.full_name, 'Chưa cập nhật') AS owner,
        c.phone, c.email,
        COALESCE(vt.name, 'Chưa xác định') AS vehicleType,
        vt.id AS vehicleTypeId, vt.code AS vehicleTypeCode
      FROM vehicles v
      JOIN customers c ON c.id = v.customer_id
      LEFT JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
      ${where}
      ORDER BY v.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset],
    );
    const [vehicleTypes] = await pool.query("SELECT id, code, name FROM vehicle_types ORDER BY id");
    return response.json({ vehicles: rows, total: Number(total), page: Number(page), limit: Number(limit), vehicleTypes });
  } catch (error) {
    console.error("Vehicles query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải danh sách phương tiện." });
  }
});

dashboardRouter.post("/vehicles", async (request, response) => {
  const { plate, vehicleTypeId, ownerName, ownerPhone, ownerEmail } = request.body;
  if (!plate || !vehicleTypeId || !ownerName) {
    return response.status(400).json({ message: "Biển số, loại xe và tên chủ xe là bắt buộc." });
  }
  const plateNormalized = plate.toUpperCase().replace(/[\s\-\.]/g, "");
  const plateDisplay = plate.toUpperCase().trim();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.query(
      "SELECT id FROM vehicles WHERE plate_normalized = ? LIMIT 1", [plateNormalized]
    );
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ message: "Biển số đã được đăng ký trong hệ thống." });
    }
    let customerId;
    const [[existingCustomer]] = await connection.query(
      "SELECT id FROM customers WHERE email = ? OR phone = ? LIMIT 1",
      [ownerEmail || null, ownerPhone || null]
    );
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const [custResult] = await connection.query(
        "INSERT INTO customers (full_name, phone, email) VALUES (?, ?, ?)",
        [ownerName, ownerPhone || null, ownerEmail || null]
      );
      customerId = custResult.insertId;
    }
    const [vResult] = await connection.query(
      `INSERT INTO vehicles (customer_id, vehicle_type_id, plate_normalized, plate_display, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [customerId, vehicleTypeId, plateNormalized, plateDisplay]
    );
    await connection.commit();
    return response.status(201).json({ message: "Đã thêm phương tiện thành công.", vehicleId: vResult.insertId });
  } catch (error) {
    await connection.rollback();
    console.error("Add vehicle failed:", error.message);
    return response.status(500).json({ message: "Không thể thêm phương tiện." });
  } finally {
    connection.release();
  }
});

dashboardRouter.patch("/vehicles/:id", async (request, response) => {
  const vehicleId = Number(request.params.id);
  const { status, vehicleTypeId, plate } = request.body;
  if (!Number.isInteger(vehicleId) || vehicleId < 1) {
    return response.status(400).json({ message: "ID phương tiện không hợp lệ." });
  }
  try {
    const fields = [];
    const params = [];
    if (status) { fields.push("status = ?"); params.push(status); }
    if (vehicleTypeId) { fields.push("vehicle_type_id = ?"); params.push(vehicleTypeId); }
    if (plate) {
      fields.push("plate_display = ?", "plate_normalized = ?");
      params.push(plate.toUpperCase().trim(), plate.toUpperCase().replace(/[\s\-\.]/g, ""));
    }
    if (!fields.length) return response.status(400).json({ message: "Không có trường nào để cập nhật." });
    params.push(vehicleId);
    await pool.query(`UPDATE vehicles SET ${fields.join(", ")} WHERE id = ?`, params);
    return response.json({ message: "Cập nhật phương tiện thành công." });
  } catch (error) {
    console.error("Update vehicle failed:", error.message);
    return response.status(500).json({ message: "Không thể cập nhật phương tiện." });
  }
});

dashboardRouter.delete("/vehicles/:id", async (request, response) => {
  const vehicleId = Number(request.params.id);
  try {
    await pool.query("UPDATE vehicles SET status = 'inactive' WHERE id = ?", [vehicleId]);
    return response.json({ message: "Đã vô hiệu hóa phương tiện." });
  } catch (error) {
    return response.status(500).json({ message: "Không thể vô hiệu hóa phương tiện." });
  }
});

/* ─── Users / Tài khoản ETC ─── */
dashboardRouter.get("/users", async (request, response) => {
  const { search = "", role = "", page = 1, limit = 20 } = request.query;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    let where = "WHERE u.role != 'admin'";
    const params = [];
    if (search) { where += " AND (u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (role) { where += " AND u.role = ?"; params.push(role); }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
    const [rows] = await pool.query(`
      SELECT u.id, u.username, u.full_name AS fullName, u.email, u.role, u.is_active AS isActive,
        u.email_verified_at AS emailVerifiedAt, u.last_login_at AS lastLoginAt,
        u.created_at AS createdAt,
        COALESCE(a.balance, 0) AS balance, a.id AS accountId,
        COUNT(DISTINCT v.id) AS vehicleCount
      FROM users u
      LEFT JOIN customers c ON c.user_id = u.id
      LEFT JOIN accounts a ON a.customer_id = c.id
      LEFT JOIN vehicles v ON v.customer_id = c.id
      ${where}
      GROUP BY u.id, a.balance, a.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset],
    );
    return response.json({ users: rows, total: Number(total), page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Users query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải danh sách người dùng." });
  }
});

dashboardRouter.patch("/users/:id", async (request, response) => {
  const userId = Number(request.params.id);
  const { isActive, role } = request.body;
  if (!Number.isInteger(userId) || userId < 1) {
    return response.status(400).json({ message: "ID người dùng không hợp lệ." });
  }
  try {
    const fields = [];
    const params = [];
    if (isActive !== undefined) { fields.push("is_active = ?"); params.push(isActive ? 1 : 0); }
    if (role) { fields.push("role = ?"); params.push(role); }
    if (!fields.length) return response.status(400).json({ message: "Không có trường nào để cập nhật." });
    params.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND role != 'admin'`, params);
    return response.json({ message: "Cập nhật người dùng thành công." });
  } catch (error) {
    console.error("Update user failed:", error.message);
    return response.status(500).json({ message: "Không thể cập nhật người dùng." });
  }
});

/* ─── Nạp tiền ví ─── */
dashboardRouter.post("/users/:id/topup", async (request, response) => {
  const userId = Number(request.params.id);
  const { amount, note } = request.body;
  if (!Number.isInteger(userId) || userId < 1 || !amount || Number(amount) <= 0) {
    return response.status(400).json({ message: "Thông tin nạp tiền không hợp lệ." });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.query(`
      SELECT a.id, a.balance FROM accounts a
      JOIN customers c ON c.id = a.customer_id
      WHERE c.user_id = ? FOR UPDATE`, [userId]);
    if (!account) { await connection.rollback(); return response.status(404).json({ message: "Không tìm thấy ví của người dùng." }); }
    const newBalance = Number(account.balance) + Number(amount);
    await connection.query("UPDATE accounts SET balance = ? WHERE id = ?", [newBalance, account.id]);
    await connection.query(
      "INSERT INTO wallet_transactions (account_id, type, amount, balance_after, note) VALUES (?, 'topup', ?, ?, ?)",
      [account.id, Number(amount), newBalance, note || "Nạp tiền bởi Admin"]
    );
    await connection.commit();
    return response.json({ message: `Đã nạp ${Number(amount).toLocaleString("vi-VN")} VNĐ vào ví.`, newBalance });
  } catch (error) {
    await connection.rollback();
    console.error("Topup failed:", error.message);
    return response.status(500).json({ message: "Không thể nạp tiền." });
  } finally {
    connection.release();
  }
});

/* ─── Transactions (giao dịch thu phí) ─── */
dashboardRouter.get("/transactions", async (request, response) => {
  const { search = "", status = "", page = 1, limit = 20 } = request.query;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    let where = "WHERE 1=1";
    const params = [];
    if (search) { where += " AND (v.plate_display LIKE ? OR v.plate_normalized LIKE ? OR c.full_name LIKE ?)"; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (status) { where += " AND t.status = ?"; params.push(status); }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM toll_transactions t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN customers c ON c.id = v.customer_id ${where}`,
      params,
    );
    const [rows] = await pool.query(`
      SELECT t.id, COALESCE(v.plate_display, v.plate_normalized, 'Xe chưa đăng ký') AS plate,
        COALESCE(c.full_name, 'Chưa cập nhật') AS owner,
        t.fee, t.status, DATE_FORMAT(t.passed_at, '%d/%m/%Y %H:%i:%s') AS passedAt,
        COALESCE(ts.name, 'Chưa xác định') AS station, l.lane_no AS laneNo,
        COALESCE(vt.name, 'Chưa xác định') AS vehicleType
      FROM toll_transactions t
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      LEFT JOIN customers c ON c.id = v.customer_id
      LEFT JOIN lanes l ON l.id = t.lane_id
      LEFT JOIN toll_stations ts ON ts.id = l.station_id
      LEFT JOIN vehicle_types vt ON vt.id = t.vehicle_type_id
      ${where}
      ORDER BY t.passed_at DESC
      LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset],
    );
    return response.json({ transactions: rows, total: Number(total), page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Transactions query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải lịch sử giao dịch." });
  }
});

/* ─── Lanes (trạng thái làn) ─── */
dashboardRouter.get("/lanes", async (request, response) => {
  try {
    const [lanes] = await pool.query(`
      SELECT l.id, l.lane_no AS laneNo, l.direction, l.camera_url AS cameraUrl, l.is_active AS isActive,
        ts.name AS stationName, ts.code AS stationCode,
        CASE WHEN EXISTS (
          SELECT 1 FROM devices rfid WHERE rfid.lane_id = l.id AND rfid.type = 'rfid_reader'
        ) THEN 'ETC' ELSE 'Hỗn hợp' END AS laneType,
        COALESCE(d.status, 'offline') AS deviceStatus,
        COUNT(DISTINCT CASE WHEN DATE(tt.passed_at) = CURRENT_DATE() THEN tt.id END) AS todayCount,
        COUNT(DISTINCT CASE WHEN DATE(tt.passed_at) = CURRENT_DATE() AND tt.status = 'paid' THEN tt.id END) AS todayPaid
      FROM lanes l
      JOIN toll_stations ts ON ts.id = l.station_id
      LEFT JOIN devices d ON d.lane_id = l.id AND d.type = 'camera'
      LEFT JOIN toll_transactions tt ON tt.lane_id = l.id
      GROUP BY l.id, l.lane_no, l.direction, l.camera_url, l.is_active, ts.name, ts.code, d.status
      ORDER BY ts.id, l.lane_no`);

    const [devices] = await pool.query(`
      SELECT d.id, d.lane_id AS laneId, d.type, d.name, d.status, d.last_seen_at AS lastSeenAt
      FROM devices d ORDER BY d.lane_id, d.type`);

    return response.json({ lanes, devices });
  } catch (error) {
    console.error("Lanes query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải dữ liệu làn thu phí." });
  }
});

dashboardRouter.patch("/lanes/:id", async (request, response) => {
  const laneId = Number(request.params.id);
  const { isActive, cameraUrl } = request.body;
  try {
    const fields = [];
    const params = [];
    if (isActive !== undefined) { fields.push("is_active = ?"); params.push(isActive ? 1 : 0); }
    if (cameraUrl !== undefined) { fields.push("camera_url = ?"); params.push(cameraUrl); }
    if (!fields.length) return response.status(400).json({ message: "Không có trường nào để cập nhật." });
    params.push(laneId);
    await pool.query(`UPDATE lanes SET ${fields.join(", ")} WHERE id = ?`, params);
    return response.json({ message: "Cập nhật làn thành công." });
  } catch (error) {
    return response.status(500).json({ message: "Không thể cập nhật làn." });
  }
});

/* ─── Reports (báo cáo thống kê) ─── */
dashboardRouter.get("/reports", async (request, response) => {
  const { period = "7" } = request.query;
  const days = Math.min(Number(period) || 7, 90);
  try {
    const [dailyRevenue] = await pool.query(`
      SELECT DATE_FORMAT(DATE(passed_at), '%d/%m') AS day,
        COUNT(*) AS vehicleCount,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN fee ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paidCount,
        COUNT(CASE WHEN status = 'unpaid' THEN 1 END) AS unpaidCount,
        COUNT(CASE WHEN status = 'manual_review' THEN 1 END) AS reviewCount
      FROM toll_transactions
      WHERE passed_at >= CURRENT_DATE() - INTERVAL ? DAY
      GROUP BY DATE(passed_at)
      ORDER BY DATE(passed_at)`, [days]);

    const [byVehicleType] = await pool.query(`
      SELECT COALESCE(vt.name, 'Chưa xác định') AS vehicleType,
        COUNT(*) AS total, COALESCE(SUM(CASE WHEN t.status = 'paid' THEN t.fee ELSE 0 END), 0) AS revenue
      FROM toll_transactions t
      LEFT JOIN vehicle_types vt ON vt.id = t.vehicle_type_id
      WHERE t.passed_at >= CURRENT_DATE() - INTERVAL ? DAY
      GROUP BY vt.id, vt.name ORDER BY revenue DESC`, [days]);

    const [byStation] = await pool.query(`
      SELECT COALESCE(ts.name, 'Chưa xác định') AS station,
        COUNT(*) AS total, COALESCE(SUM(CASE WHEN t.status = 'paid' THEN t.fee ELSE 0 END), 0) AS revenue
      FROM toll_transactions t
      LEFT JOIN lanes l ON l.id = t.lane_id
      LEFT JOIN toll_stations ts ON ts.id = l.station_id
      WHERE t.passed_at >= CURRENT_DATE() - INTERVAL ? DAY
      GROUP BY ts.id, ts.name ORDER BY revenue DESC`, [days]);

    const [[summary]] = await pool.query(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN fee ELSE 0 END), 0) AS revenue,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid,
        COUNT(CASE WHEN status = 'unpaid' THEN 1 END) AS unpaid,
        COUNT(CASE WHEN status = 'manual_review' THEN 1 END) AS review
      FROM toll_transactions
      WHERE passed_at >= CURRENT_DATE() - INTERVAL ? DAY`, [days]);

    return response.json({ dailyRevenue, byVehicleType, byStation, summary, period: days });
  } catch (error) {
    console.error("Reports query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải báo cáo thống kê." });
  }
});

/* ─── Live camera / detections ─── */
dashboardRouter.get("/live", async (_request, response) => {
  try {
    const [detections] = await pool.query(`
      SELECT pd.id, pd.plate_raw AS plateRaw, pd.plate_normalized AS plateNormalized,
        pd.vehicle_class AS vehicleClass, pd.confidence,
        COALESCE(CONCAT(ROUND(pd.confidence * 100, 1), '%'), '--') AS confidenceLabel,
        pd.image_path AS imagePath, pd.processed,
        DATE_FORMAT(pd.detected_at, '%d/%m/%Y %H:%i:%s') AS detectedAt,
        l.lane_no AS laneNo, ts.name AS stationName
      FROM plate_detections pd
      JOIN lanes l ON l.id = pd.lane_id
      JOIN toll_stations ts ON ts.id = l.station_id
      ORDER BY pd.detected_at DESC LIMIT 50`);
    const [cameras] = await pool.query(`
      SELECT d.id, d.name, d.status, d.last_seen_at AS lastSeenAt,
        l.lane_no AS laneNo, l.camera_url AS cameraUrl, ts.name AS stationName
      FROM devices d
      JOIN lanes l ON l.id = d.lane_id
      JOIN toll_stations ts ON ts.id = l.station_id
      WHERE d.type = 'camera'
      ORDER BY ts.id, l.lane_no`);
    return response.json({ detections, cameras });
  } catch (error) {
    console.error("Live query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải dữ liệu camera." });
  }
});

/* ─── Settings ─── */
dashboardRouter.get("/settings", async (_request, response) => {
  try {
    const [stations] = await pool.query("SELECT id, code, name, location, is_active FROM toll_stations ORDER BY id");
    const [vehicleTypes] = await pool.query("SELECT id, code, name FROM vehicle_types ORDER BY id");
    const [rates] = await pool.query(`
      SELECT tr.id, ts.name AS stationName, vt.name AS vehicleType, tr.fee, tr.effective_from, tr.effective_to
      FROM toll_rates tr
      JOIN toll_stations ts ON ts.id = tr.station_id
      JOIN vehicle_types vt ON vt.id = tr.vehicle_type_id
      ORDER BY ts.id, vt.id`);
    return response.json({ stations, vehicleTypes, rates });
  } catch (error) {
    console.error("Settings query failed:", error.message);
    return response.status(500).json({ message: "Không thể tải cài đặt hệ thống." });
  }
});
