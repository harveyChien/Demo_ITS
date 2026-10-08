import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter } from "./routes/auth.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { ensureAdminAccount, pool, testDatabaseConnection } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number.parseInt(process.env.PORT || "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT phải là số nguyên trong khoảng 1-65535.");
}

app.use(cors());
app.use(express.json());
const frontendPath = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(frontendPath));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));
app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);

app.get("/api/health/database", async (_request, response) => {
  try {
    await testDatabaseConnection();
    response.json({ status: "ok", database: process.env.MYSQL_DATABASE });
  } catch (error) {
    console.error("MySQL connection failed:", error.message);
    response.status(503).json({
      status: "error",
      message: "Không thể kết nối MySQL.",
    });
  }
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(frontendPath, "index.html"));
});

async function startServer() {
  try {
    await testDatabaseConnection();
    const created = await ensureAdminAccount();
    console.log(created ? "Admin account created from backend/.env." : "Admin account already exists.");

    await new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`ITS Smart Traffic running at http://localhost:${port}`);
        resolve(server);
      });

      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `Cổng ${port} đang được sử dụng. ` +
                `Hãy dừng tiến trình đang chạy hoặc đổi PORT trong backend/.env.`,
            ),
          );
          return;
        }
        reject(error);
      });
    });
  } catch (error) {
    console.error("Server startup failed:", error instanceof Error ? error.message : error);
    await pool.end().catch((closeError) => {
      console.error("Failed to close MySQL pool:", closeError instanceof Error ? closeError.message : closeError);
    });
    process.exitCode = 1;
  }
}

startServer();
