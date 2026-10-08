import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import "dotenv/config";

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE || "its_toll",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
});

export async function testDatabaseConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.query("SELECT 1");
    return true;
  } finally {
    connection.release();
  }
}

export async function ensureAdminAccount() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME || "Quản trị viên";

  if (!username || !password) {
    throw new Error("Thiếu ADMIN_USERNAME hoặc ADMIN_PASSWORD trong backend/.env.");
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD phải có ít nhất 10 ký tự.");
  }

  const [rows] = await pool.execute(
    "SELECT id, password_hash FROM users WHERE username = ? AND role = 'admin' LIMIT 1",
    [username],
  );
  if (rows.length > 0) {
    const admin = rows[0];
    const passwordMatches = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatches) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.execute(
        "UPDATE users SET password_hash = ?, full_name = ?, is_active = 1 WHERE id = ?",
        [passwordHash, fullName, admin.id],
      );
      return true;
    }
    return false;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.execute(
    `INSERT INTO users (username, password_hash, full_name, role, is_active)
     VALUES (?, ?, ?, 'admin', 1)`,
    [username, passwordHash, fullName],
  );
  return true;
}
