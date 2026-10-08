import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { pool } from "../db.js";
import { sendActivationCode } from "../mail.js";

export const authRouter = Router();

authRouter.post("/login", async (request, response) => {
  const { identifier, password, role } = request.body;
  if (!identifier || !password || !["user", "admin"].includes(role)) {
    return response.status(400).json({ message: "Thông tin đăng nhập không hợp lệ." });
  }
  if (role === "user" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    return response.status(400).json({ message: "User phải đăng nhập bằng email." });
  }

  const [rows] = await pool.execute(
    role === "admin"
      ? `SELECT id, username, full_name, password_hash, role, is_active
         FROM users WHERE username = ? AND role = 'admin' LIMIT 1`
      : `SELECT id, email, full_name, password_hash, role, is_active, email_verified_at
         FROM users WHERE email = ? AND role = 'customer' LIMIT 1`,
    [identifier.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return response.status(401).json({ message: "Tài khoản hoặc mật khẩu không đúng." });
  }
  if (role === "user" && !user.email_verified_at) {
    return response.status(403).json({ message: "Vui lòng kích hoạt email trước khi đăng nhập." });
  }

  await pool.execute("UPDATE users SET last_login_at = NOW() WHERE id = ?", [user.id]);
  return response.json({
    user: {
      id: user.id,
      role: user.role === "admin" ? "admin" : "user",
      roleLabel: user.role === "admin" ? "Quản trị viên" : "Người dùng",
      displayName: user.full_name,
    },
  });
});

authRouter.post("/register", async (request, response) => {
  const { email, password, displayName } = request.body;
  if (!email || !password || !displayName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ message: "Email, họ tên và mật khẩu là bắt buộc." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.execute(
      "SELECT id, email_verified_at FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );
    if (existing.length && existing[0].email_verified_at) {
      return response.status(409).json({ message: "Email đã được đăng ký." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const code = String(crypto.randomInt(100000, 1000000));
    const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await connection.beginTransaction();

    let userId;
    if (existing.length) {
      userId = existing[0].id;
      await connection.execute(
        "UPDATE users SET password_hash = ?, full_name = ?, role = 'customer', is_active = 1 WHERE id = ?",
        [passwordHash, displayName.trim(), userId],
      );
      await connection.execute(
        "DELETE FROM verification_tokens WHERE user_id = ? AND type = 'verify_email'",
        [userId],
      );
    } else {
      const [result] = await connection.execute(
        `INSERT INTO users (username, email, password_hash, full_name, role)
         VALUES (NULL, ?, ?, ?, 'customer')`,
        [normalizedEmail, passwordHash, displayName.trim()],
      );
      userId = result.insertId;
    }

    const [customerRows] = await connection.execute(
      "SELECT id FROM customers WHERE user_id = ? LIMIT 1",
      [userId],
    );
    let customerId;
    if (customerRows.length) {
      customerId = customerRows[0].id;
      await connection.execute(
        "UPDATE customers SET full_name = ?, email = ? WHERE id = ?",
        [displayName.trim(), normalizedEmail, customerId],
      );
    } else {
      const [customerResult] = await connection.execute(
        "INSERT INTO customers (user_id, full_name, email) VALUES (?, ?, ?)",
        [userId, displayName.trim(), normalizedEmail],
      );
      customerId = customerResult.insertId;
    }
    await connection.execute(
      "INSERT INTO accounts (customer_id) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE customer_id = ?)",
      [customerId, customerId],
    );

    await connection.execute(
      `INSERT INTO verification_tokens (user_id, type, token_hash, expires_at)
       VALUES (?, 'verify_email', ?, ?)`,
      [userId, tokenHash, expiresAt],
    );
    await connection.commit();
    await sendActivationCode(normalizedEmail, code);
    return response.status(201).json({ message: "Mã kích hoạt đã được gửi tới Gmail." });
  } catch (error) {
    await connection.rollback();
    console.error("User registration failed:", error.message);
    return response.status(500).json({
      message: error.message.includes("Gmail từ chối đăng nhập SMTP")
        ? error.message
        : "Không thể gửi mã kích hoạt. Vui lòng kiểm tra cấu hình Gmail SMTP.",
    });
  } finally {
    connection.release();
  }
});

authRouter.post("/verify-email", async (request, response) => {
  const { email, code } = request.body;
  if (!email || !/^\d{6}$/.test(code || "")) {
    return response.status(400).json({ message: "Email hoặc mã kích hoạt không hợp lệ." });
  }
  const tokenHash = crypto.createHash("sha256").update(code).digest("hex");
  const [rows] = await pool.execute(
    `SELECT vt.id, vt.user_id FROM verification_tokens vt
     JOIN users u ON u.id = vt.user_id
     WHERE u.email = ? AND vt.type = 'verify_email'
       AND vt.token_hash = ? AND vt.used_at IS NULL AND vt.expires_at > NOW()
     LIMIT 1`,
    [email.trim().toLowerCase(), tokenHash],
  );
  if (!rows.length) return response.status(400).json({ message: "Mã kích hoạt sai hoặc đã hết hạn." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("UPDATE users SET email_verified_at = NOW() WHERE id = ?", [rows[0].user_id]);
    await connection.execute("UPDATE verification_tokens SET used_at = NOW() WHERE id = ?", [rows[0].id]);
    await connection.commit();
    return response.json({ message: "Kích hoạt tài khoản thành công. Bạn có thể đăng nhập." });
  } catch (error) {
    await connection.rollback();
    return response.status(500).json({ message: "Không thể kích hoạt tài khoản." });
  } finally {
    connection.release();
  }
});
