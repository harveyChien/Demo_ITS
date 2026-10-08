import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ─────────────────────────────────────────────
   HELPERS & CONSTANTS
───────────────────────────────────────────── */
const BASE = "";   // production: "" (same origin), dev: proxy via vite

const emptyDashboard = {
  generatedAt: "--",
  live: {
    stationName: "Chưa có trạm", laneNo: "--", deviceStatus: "OFFLINE",
    plate: "", vehicleClass: "", confidence: "--", detectedAt: "--",
    imagePath: "", barrierStatus: "OFFLINE",
  },
  recentDetections: [], registeredVehicles: [], transactions: [],
  alerts: 0, summary: [], laneStatus: [], dailyStats: [], vehicleClasses: [],
};

async function req(url, options) {
  try {
    const response = await fetch(BASE + url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Yêu cầu thất bại.");
    return data;
  } catch (err) {
    if (err instanceof TypeError) throw new Error("Không thể kết nối backend — hãy mở http://localhost:3000.");
    throw err;
  }
}

const money = (v) => `${Number(v || 0).toLocaleString("vi-VN")} VNĐ`;

const STATUS_LABEL = {
  pending: "Chờ duyệt", active: "Hoạt động", rejected: "Từ chối",
  blacklisted: "Đen sách", inactive: "Vô hiệu",
  paid: "Đã TT", unpaid: "Chưa TT", manual_review: "Cần xét",
  failed: "Lỗi", exempt: "Miễn phí", refunded: "Hoàn tiền",
  online: "Online", offline: "Offline", maintenance: "Bảo trì",
};
const STATUS_CLS = {
  pending: "pill-warn", active: "pill-ok", rejected: "pill-err",
  blacklisted: "pill-err", inactive: "pill-muted",
  paid: "pill-ok", unpaid: "pill-err", manual_review: "pill-warn",
  failed: "pill-err", exempt: "pill-ok", refunded: "pill-muted",
  online: "pill-ok", offline: "pill-err", maintenance: "pill-warn",
};

/* ─── Shared mini-components ─── */
function Pill({ s }) {
  return <em className={`pill ${STATUS_CLS[s] || "pill-muted"}`}>{STATUS_LABEL[s] || s}</em>;
}
function Loader({ text = "Đang tải dữ liệu từ MySQL..." }) {
  return (
    <div className="page-loader">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}
function Empty({ icon = "📭", text }) {
  return (
    <div className="empty-block">
      <span>{icon}</span>
      <p>{text}</p>
    </div>
  );
}
function Notice({ msg, onDismiss }) {
  if (!msg) return null;
  const ok = msg.startsWith("✅");
  return (
    <div className={`notice-bar ${ok ? "notice-ok" : "notice-err"} animate-fadein`} onClick={onDismiss}>
      {msg} <span>✕</span>
    </div>
  );
}
function Pagination({ page, total, limit, setPage }) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Trước</button>
      <span>Trang {page} / {pages} · {total} bản ghi</span>
      <button disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau ›</button>
    </div>
  );
}
function SectionTitle({ title, sub, action }) {
  return (
    <div className="section-title">
      <div>
        <h2 className="view-title">{title}</h2>
        {sub && <p className="view-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ─────────────────────────────────────────────
   BRAND
───────────────────────────────────────────── */
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">ITS</span>
      <span>Smart Traffic</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   CAMERA PANEL with animations
───────────────────────────────────────────── */
function CameraPanel({ live, compact = false }) {
  const [tick, setTick] = useState(0);
  const [scanY, setScanY] = useState(10);
  const [scanDir, setScanDir] = useState(1);
  const [blinkOn, setBlinkOn] = useState(true);
  const [corner, setCorner] = useState(0);

  // Scan line animation
  useEffect(() => {
    const id = setInterval(() => {
      setScanY((y) => {
        const next = y + scanDir * 2.5;
        if (next >= 85) { setScanDir(-1); return 85; }
        if (next <= 8)  { setScanDir(1);  return 8; }
        return next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [scanDir]);

  // LIVE blink
  useEffect(() => {
    const id = setInterval(() => setBlinkOn((v) => !v), 700);
    return () => clearInterval(id);
  }, []);

  // Corner pulse
  useEffect(() => {
    const id = setInterval(() => setCorner((v) => (v + 1) % 4), 800);
    return () => clearInterval(id);
  }, []);

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isOnline = live.deviceStatus === "ĐANG ONLINE";
  const barrierOpen = live.barrierStatus === "ĐANG MỞ";
  const now = new Date().toLocaleTimeString("vi-VN");

  return (
    <div className={`cam-panel ${compact ? "cam-compact" : ""}`}>
      {/* Camera viewport */}
      <div className="cam-viewport" style={live.imagePath ? { backgroundImage: `url("${live.imagePath}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}}>
        {!live.imagePath && (
          <div className="cam-bg-grid" />
        )}

        {/* Overlay gradients */}
        <div className="cam-overlay-top" />
        <div className="cam-overlay-bottom" />

        {/* Live badge */}
        <div className={`cam-live-badge ${blinkOn ? "blink-on" : "blink-off"}`}>
          <span className="live-dot-cam" />
          LIVE
        </div>

        {/* Timestamp */}
        <div className="cam-timestamp">{now}</div>

        {/* Status top-right */}
        <div className={`cam-status-badge ${isOnline ? "cam-online" : "cam-offline"}`}>
          ● {live.deviceStatus}
        </div>

        {/* Detection box with animation */}
        <div className={`cam-detect-frame ${live.plate ? "detect-active" : "detect-idle"}`}>
          {/* Animated corners */}
          <div className={`cam-corner tl ${corner === 0 ? "corner-pulse" : ""}`} />
          <div className={`cam-corner tr ${corner === 1 ? "corner-pulse" : ""}`} />
          <div className={`cam-corner bl ${corner === 2 ? "corner-pulse" : ""}`} />
          <div className={`cam-corner br ${corner === 3 ? "corner-pulse" : ""}`} />

          {/* Scan line */}
          <div className="cam-scan-line" style={{ top: `${scanY}%` }} />

          {/* Plate result */}
          {live.plate && (
            <div className="cam-plate-result">
              <span className="cam-plate-text">{live.plate}</span>
              <span className="cam-confidence">{live.confidence}</span>
            </div>
          )}
        </div>

        {/* Detection info overlay */}
        <div className="cam-info-row">
          <span>🚗 {live.vehicleClass || "Chờ phát hiện..."}</span>
          <span>📍 {live.stationName} · Làn {live.laneNo}</span>
        </div>
      </div>

      {/* Controls row */}
      <div className="cam-controls-row">
        <div className={`barrier-indicator ${barrierOpen ? "barrier-open" : "barrier-closed"}`}>
          <div className="barrier-light-dot" />
          <span>Barrier: <b>{live.barrierStatus}</b></span>
        </div>
        <div className="cam-detect-time">
          ⏱ {live.detectedAt !== "--" ? live.detectedAt : "Chưa có nhận diện"}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   AUTH SCREEN
───────────────────────────────────────────── */
function AuthScreen({ onLogin }) {
  const [role, setRole] = useState("user");
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ identifier: "", password: "", displayName: "", confirmPassword: "" });
  const [pendingEmail, setPendingEmail] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const isRegister = role === "user" && mode === "register";
  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setMsg("Đang xử lý...");
    try {
      if (isRegister) {
        if (form.password !== form.confirmPassword) throw new Error("Mật khẩu xác nhận không khớp.");
        await req("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.identifier, password: form.password, displayName: form.displayName }),
        });
        setPendingEmail(form.identifier);
        setMsg("✅ Mã kích hoạt đã được gửi tới email của bạn.");
        return;
      }
      const session = await req("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: form.identifier, password: form.password, role }),
      });
      onLogin(session.user);
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); }
  }

  async function verify(e) {
    e.preventDefault();
    setVerifyMsg("Đang kiểm tra mã...");
    try {
      await req("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      setVerifyMsg("✅ Kích hoạt thành công! Bạn có thể đăng nhập.");
      setMode("login"); setCode(""); setPendingEmail("");
    } catch (err) { setVerifyMsg(err.message); }
  }

  return (
    <main className="shell animate-fadein">
      {/* Left: visual + camera animation */}
      <section className="visual-panel">
        <div className="visual-topbar">
          <Brand />
          <span className="secure-label"><span className="status-dot" /> Hệ thống an toàn</span>
        </div>
        <div className="visual-copy">
          <p className="eyebrow">Intelligent Transportation System</p>
          <h1>Giám sát giao thông<br /><em>thông minh hơn.</em></h1>
          <p className="visual-description">
            Nhận diện biển số tự động bằng YOLO + OCR, thu phí ETC không dừng,
            quản lý toàn bộ trạm trong một nền tảng.
          </p>
        </div>
        {/* Animated camera demo */}
        <div className="monitor-card">
          <div className="monitor-header">
            <span><span className="live-dot" /> LIVE · CAMERA 01</span>
            <span className="camera-time">{new Date().toLocaleTimeString("vi-VN")}</span>
          </div>
          <div className="camera-frame">
            <div className="road-lines" />
            <div className="car">
              <div className="car-window" />
              <div className="car-body" />
              <div className="plate">29A-123.45</div>
              <div className="wheel left" />
              <div className="wheel right" />
            </div>
            <div className="scan-box"><span>NHẬN DIỆN</span></div>
            <div className="scan-line" />
            <div className="camera-corner corner-tl" />
            <div className="camera-corner corner-tr" />
            <div className="camera-corner corner-bl" />
            <div className="camera-corner corner-br" />
          </div>
          <div className="monitor-footer">
            <span><i className="mini-icon green" /> Đang quét biển số</span>
            <strong>98.2% <small>độ chính xác</small></strong>
          </div>
        </div>
        <div className="stats-row">
          <div><strong>2,847</strong><span>Phương tiện hôm nay</span></div>
          <div><strong>98.2%</strong><span>Độ chính xác OCR</span></div>
          <div><strong>24/7</strong><span>Giám sát liên tục</span></div>
        </div>
        <div className="visual-glow" />
      </section>

      {/* Right: login form */}
      <section className="login-panel">
        <div className="login-content">
          <div className="mobile-brand"><Brand /></div>
          <div className="login-heading">
            <p className="eyebrow">Chào mừng trở lại</p>
            <h2>Đăng nhập hệ thống</h2>
            <p>Truy cập không gian làm việc của bạn để bắt đầu.</p>
          </div>

          <div className="role-switch" role="tablist">
            {[["user", "●", "Người dùng", "Giám sát & ETC"], ["admin", "✦", "Quản trị viên", "Toàn quyền quản lý"]].map(([r, icon, label, sub]) => (
              <button key={r} type="button"
                className={`role-btn ${role === r ? "active" : ""}`}
                onClick={() => { setRole(r); if (r === "admin") setMode("login"); }}>
                <span className={`role-icon ${r === "user" ? "user-icon" : "admin-icon"}`}>{icon}</span>
                <span><b>{label}</b><small>{sub}</small></span>
              </button>
            ))}
          </div>

          <div className="auth-tabs">
            <button className={`auth-tab ${mode === "login" ? "active" : ""}`} type="button" onClick={() => setMode("login")}>Đăng nhập</button>
            {role === "user" && <button className={`auth-tab ${mode === "register" ? "active" : ""}`} type="button" onClick={() => setMode("register")}>Đăng ký</button>}
          </div>

          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="identifier">{role === "admin" ? "Tài khoản Admin" : "Email"}</label>
              <div className="input-wrap">
                <span className="input-icon">{role === "admin" ? "▣" : "@"}</span>
                <input id="identifier" name="identifier"
                  type={role === "admin" ? "text" : "email"}
                  value={form.identifier} onChange={update}
                  placeholder={role === "admin" ? "Nhập tên tài khoản" : "Nhập email"} required />
              </div>
            </div>
            {isRegister && (
              <div className="field">
                <label htmlFor="displayName">Họ và tên</label>
                <div className="input-wrap">
                  <span className="input-icon">◉</span>
                  <input id="displayName" name="displayName" value={form.displayName} onChange={update} placeholder="Họ và tên đầy đủ" required />
                </div>
              </div>
            )}
            <div className="field">
              <div className="label-row">
                <label htmlFor="password">Mật khẩu</label>
                <a href="#forgot" onClick={(e) => { e.preventDefault(); setMsg("Vui lòng liên hệ quản trị để đặt lại mật khẩu."); }}>Quên mật khẩu?</a>
              </div>
              <div className="input-wrap">
                <span className="input-icon lock-icon">◇</span>
                <input id="password" name="password" type={showPw ? "text" : "password"} value={form.password} onChange={update} minLength="6" required />
                <button type="button" className="password-toggle" onClick={() => setShowPw(!showPw)}>{showPw ? "Ẩn" : "Hiện"}</button>
              </div>
            </div>
            {isRegister && (
              <div className="field">
                <label htmlFor="confirmPassword">Xác nhận mật khẩu</label>
                <div className="input-wrap">
                  <span className="input-icon lock-icon">◇</span>
                  <input id="confirmPassword" name="confirmPassword" type="password" value={form.confirmPassword} onChange={update} required />
                </div>
              </div>
            )}
            <button className="submit-btn" type="submit" disabled={loading}>
              <span>{isRegister ? "Tạo tài khoản" : "Đăng nhập"}</span>
              <span className="arrow">{loading ? "⟳" : "→"}</span>
            </button>
            <p className="form-message" style={{ color: msg.startsWith("✅") ? "#16a34a" : "#e05252" }}>{msg}</p>
          </form>

          {pendingEmail && (
            <form className="verify-form" onSubmit={verify}>
              <div className="field">
                <label htmlFor="activationCode">Mã kích hoạt (6 chữ số)</label>
                <div className="input-wrap">
                  <span className="input-icon">#</span>
                  <input id="activationCode" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="Nhập mã 6 số" required />
                </div>
              </div>
              <button className="submit-btn" type="submit"><span>Kích hoạt tài khoản</span><span className="arrow">→</span></button>
              <p className="form-message" style={{ color: verifyMsg.startsWith("✅") ? "#16a34a" : "#e05252" }}>{verifyMsg}</p>
            </form>
          )}
          <p className="help-text">{isRegister ? "Tài khoản User đăng ký bằng email. Admin chỉ được cấp riêng." : "Admin: tài khoản được cấp riêng bởi quản trị hệ thống."}</p>
          <p className="copyright">© 2025 ITS Smart Traffic · Hệ thống thu phí thông minh</p>
        </div>
      </section>
    </main>
  );
}

/* ─────────────────────────────────────────────
   ADMIN VIEWS
───────────────────────────────────────────── */
function OverviewView({ data, setView, onUpload, uploading }) {
  const fileRef = useRef(null);
  const live = data.live;
  const maxR = Math.max(...data.dailyStats.map((i) => i.revenue), 1);
  const maxV = Math.max(...data.dailyStats.map((i) => i.vehicleCount), 1);

  return (
    <div className="animate-fadein">
      {/* Stat cards */}
      <section className="admin-stat-grid">
        {(data.summary.length ? data.summary : [
          { label: "Xe qua trạm hôm nay", value: "0", note: "Từ plate_detections", color: "blue" },
          { label: "Tổng doanh thu", value: "0 VNĐ", note: "Đã thanh toán", color: "green" },
          { label: "Xe ETC (%)", value: "0%", note: "Xe đã liên kết ví", color: "purple" },
          { label: "Tài khoản ETC", value: "0", note: "Đã đăng ký", color: "orange" },
        ]).map((item, idx) => (
          <article key={item.label} className={`admin-stat-card stat-${item.color || ["blue","green","purple","orange"][idx]}`}>
            <span className="admin-stat-icon">{["📊","₫","🚗","👤"][idx]}</span>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
            <em>{item.note}</em>
          </article>
        ))}
      </section>

      <section className="admin-main-grid">
        {/* Camera panel */}
        <article className="admin-panel camera-admin-panel">
          <div className="admin-panel-heading">
            <div><h2>Camera & Nhận diện biển số</h2><p>Dữ liệu từ plate_detections · barrier · devices</p></div>
          </div>
          <CameraPanel live={live} />
          <div className="admin-camera-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "⟳ Đang tải..." : "📁 Thêm ảnh / Video"}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden-file-input" onChange={onUpload} />
            <button type="button" className="btn-ghost" onClick={() => setView("live")}>Xem tất cả nhận diện →</button>
          </div>
          <p className="upload-help">Hỗ trợ JPG, PNG, MP4, MOV · tối đa 100 MB · sẽ ghi vào bảng plate_detections</p>
        </article>

        {/* Lane status */}
        <article className="admin-panel lanes-panel">
          <div className="admin-panel-heading"><div><h2>Trạng thái làn thu phí</h2><p>Thiết bị camera + barrier + RFID</p></div></div>
          <div className="lane-table">
            <div className="lane-row lane-heading"><b>Làn</b><b>Loại</b><b>Camera</b><b>Xe hôm nay</b></div>
            {data.laneStatus.length ? data.laneStatus.map((lane) => (
              <div key={lane.laneNo} className="lane-row">
                <b className="lane-number">{lane.laneNo}</b>
                <span>{lane.laneType}</span>
                <span className={`lane-state ${lane.deviceStatus === "Hoạt động" ? "" : "maintenance"}`}>● {lane.deviceStatus}</span>
                <strong>{Number(lane.vehicleCount || 0).toLocaleString("vi-VN")}</strong>
              </div>
            )) : <Empty icon="🔌" text="Chưa có dữ liệu làn. Kiểm tra bảng lanes + devices." />}
          </div>
          <button className="btn-ghost" style={{ marginTop: 10, width: "100%" }} onClick={() => setView("lanes")}>Quản lý làn →</button>
        </article>
      </section>

      <section className="admin-bottom-grid">
        {/* Revenue chart */}
        <article className="admin-panel revenue-panel">
          <div className="admin-panel-heading"><div><h2>Doanh thu 7 ngày</h2><p>Từ bảng toll_transactions</p></div></div>
          {data.dailyStats.length ? (
            <div className="admin-chart">
              <div className="chart-bars">
                {data.dailyStats.map((item) => (
                  <div key={item.day} className="chart-column">
                    <div className="bar-value" style={{ height: `${Math.max(5, (item.revenue / maxR) * 100)}%` }} title={money(item.revenue)} />
                    <i style={{ height: `${Math.max(4, (item.vehicleCount / maxV) * 100)}%` }} title={`${item.vehicleCount} lượt`} />
                    <small>{item.day}</small>
                  </div>
                ))}
              </div>
              <div className="chart-legend">
                <span><i className="legend-revenue" /> Doanh thu</span>
                <span><i className="legend-vehicles" /> Số lượt xe</span>
              </div>
            </div>
          ) : <Empty icon="📊" text="Chưa có dữ liệu doanh thu (toll_transactions)." />}
        </article>

        {/* Recent transactions */}
        <article className="admin-panel transactions-panel">
          <div className="admin-panel-heading">
            <div><h2>Giao dịch gần đây</h2><p>toll_transactions</p></div>
            <button type="button" className="btn-ghost" onClick={() => setView("transactions")}>Xem tất cả →</button>
          </div>
          {data.transactions.length ? data.transactions.map((item, idx) => (
            <div key={`${item.plate}-${idx}`} className="admin-transaction">
              <time>{item.passedAt || "--"}</time>
              <b>{item.plate}</b>
              <span>{item.owner}</span>
              <strong>{money(item.fee)}</strong>
              <Pill s={item.status} />
            </div>
          )) : <Empty icon="💳" text="Chưa có giao dịch." />}
        </article>

        {/* Quick tools + vehicle classes */}
        <article className="admin-panel tools-panel">
          <div className="admin-panel-heading"><div><h2>Quản lý nhanh</h2><p>Truy cập chức năng</p></div></div>
          <div className="admin-tools">
            {[["🚗","Phương tiện","vehicles"],["👥","Tài khoản ETC","users"],["💳","Giao dịch","transactions"],["⚙️","Cài đặt","settings"]].map(([icon, label, key]) => (
              <button key={label} type="button" onClick={() => setView(key)}><span>{icon}</span>{label}</button>
            ))}
          </div>
          <div className="class-list">
            <h3>Thống kê loại xe</h3>
            {data.vehicleClasses.length ? data.vehicleClasses.map((item) => (
              <div key={item.vehicleType}><span>{item.vehicleType}</span><b>{Number(item.total || 0).toLocaleString("vi-VN")}</b></div>
            )) : <Empty icon="🚗" text="Chưa có dữ liệu." />}
          </div>
        </article>
      </section>
    </div>
  );
}

/* ─── Vehicles view ─── */
function VehiclesView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ plate: "", vehicleTypeId: "", ownerName: "", ownerPhone: "", ownerEmail: "" });
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, status, page, limit: 15 });
      setData(await req(`/api/dashboard/vehicles?${p}`));
    } catch (e) { setMsg(e.message); }
    finally { setLoading(false); }
  }, [search, status, page]);

  useEffect(() => { load(); }, [load]);

  async function addVehicle(e) {
    e.preventDefault(); setSaving(true); setMsg("");
    try {
      await req("/api/dashboard/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, vehicleTypeId: Number(form.vehicleTypeId) }),
      });
      setMsg("✅ Đã thêm phương tiện thành công!");
      setShowAdd(false); setForm({ plate: "", vehicleTypeId: "", ownerName: "", ownerPhone: "", ownerEmail: "" });
      load();
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  async function changeStatus(id, newStatus) {
    try {
      await req(`/api/dashboard/vehicles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) });
      load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="animate-fadein">
      <SectionTitle title="Quản lý phương tiện" sub="Danh sách xe đăng ký ETC từ bảng vehicles"
        action={<button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>＋ Thêm phương tiện</button>} />
      <Notice msg={msg} onDismiss={() => setMsg("")} />

      {showAdd && (
        <form className="add-form animate-fadein" onSubmit={addVehicle}>
          <h3>Thêm phương tiện mới → lưu vào bảng vehicles & customers</h3>
          <div className="form-grid">
            <div className="field"><label>Biển số xe *</label><input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} placeholder="VD: 30A-123.45" required /></div>
            <div className="field"><label>Loại xe *</label>
              <select value={form.vehicleTypeId} onChange={(e) => setForm({ ...form, vehicleTypeId: e.target.value })} required>
                <option value="">-- Chọn loại xe --</option>
                {data?.vehicleTypes?.map((vt) => <option key={vt.id} value={vt.id}>{vt.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Tên chủ xe *</label><input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} placeholder="Họ và tên" required /></div>
            <div className="field"><label>Số điện thoại</label><input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} placeholder="09xxxxxxxx" /></div>
            <div className="field"><label>Email</label><input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} placeholder="email@domain.com" /></div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "⟳ Đang lưu vào MySQL..." : "💾 Lưu phương tiện"}</button>
            <button type="button" className="btn-ghost" onClick={() => setShowAdd(false)}>Hủy</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <input className="search-input" placeholder="🔍 Tìm biển số, chủ xe..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option><option value="pending">Chờ duyệt</option>
          <option value="rejected">Từ chối</option><option value="inactive">Vô hiệu</option>
          <option value="blacklisted">Danh sách đen</option>
        </select>
        <span className="count-badge">{data?.total || 0} phương tiện</span>
      </div>

      {loading ? <Loader /> : (
        <>
          <table className="data-table-full">
            <thead><tr><th>Biển số</th><th>Chủ xe</th><th>Liên hệ</th><th>Loại xe</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>
              {data?.vehicles?.length ? data.vehicles.map((v) => (
                <tr key={v.id} className="table-row-hover">
                  <td><b className="plate-tag">{v.plate}</b></td>
                  <td><b>{v.owner}</b></td>
                  <td><small style={{ lineHeight: 1.8 }}>{v.phone || "–"}<br />{v.email || "–"}</small></td>
                  <td>{v.vehicleType}</td>
                  <td><Pill s={v.status} /></td>
                  <td>
                    <div className="row-actions">
                      {v.status !== "active" && <button className="btn-xs btn-ok" onClick={() => changeStatus(v.id, "active")}>✓ Duyệt</button>}
                      {!["rejected","inactive"].includes(v.status) && <button className="btn-xs btn-err" onClick={() => changeStatus(v.id, "rejected")}>✗ Từ chối</button>}
                      {v.status !== "inactive" && <button className="btn-xs btn-muted" onClick={() => changeStatus(v.id, "inactive")}>Vô hiệu</button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="6"><Empty icon="🚗" text="Chưa có phương tiện." /></td></tr>}
            </tbody>
          </table>
          <Pagination page={page} total={data?.total || 0} limit={15} setPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ─── Users view ─── */
function UsersView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState("");
  const [topupId, setTopupId] = useState(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupNote, setTopupNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, page, limit: 15 });
      setData(await req(`/api/dashboard/users?${p}`));
    } catch (e) { setMsg(e.message); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(id, current) {
    try {
      await req(`/api/dashboard/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !current }) });
      load();
    } catch (e) { setMsg(e.message); }
  }

  async function doTopup(e) {
    e.preventDefault();
    try {
      const r = await req(`/api/dashboard/users/${topupId}/topup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(topupAmount), note: topupNote }),
      });
      setMsg(`✅ ${r.message} Số dư mới: ${money(r.newBalance)}`);
      setTopupId(null); setTopupAmount(""); setTopupNote(""); load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="animate-fadein">
      <SectionTitle title="Tài khoản ETC" sub="Danh sách users + ví điện tử (accounts)" />
      <Notice msg={msg} onDismiss={() => setMsg("")} />

      {topupId && (
        <form className="add-form animate-fadein" onSubmit={doTopup}>
          <h3>💰 Nạp tiền vào ví ETC → ghi vào wallet_transactions</h3>
          <div className="form-grid">
            <div className="field"><label>Số tiền (VNĐ) *</label><input type="number" min="10000" step="10000" value={topupAmount} onChange={(e) => setTopupAmount(e.target.value)} placeholder="500000" required /></div>
            <div className="field"><label>Ghi chú</label><input value={topupNote} onChange={(e) => setTopupNote(e.target.value)} placeholder="Nội dung nạp tiền..." /></div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary">💾 Nạp tiền & lưu DB</button>
            <button type="button" className="btn-ghost" onClick={() => setTopupId(null)}>Hủy</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <input className="search-input" placeholder="🔍 Tìm tên, email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <span className="count-badge">{data?.total || 0} tài khoản</span>
      </div>

      {loading ? <Loader /> : (
        <>
          <table className="data-table-full">
            <thead><tr><th>Họ tên</th><th>Email</th><th>Số dư ví</th><th>Xe đăng ký</th><th>Trạng thái</th><th>Đăng nhập cuối</th><th>Thao tác</th></tr></thead>
            <tbody>
              {data?.users?.length ? data.users.map((u) => (
                <tr key={u.id} className="table-row-hover">
                  <td><b>{u.fullName}</b></td>
                  <td><small>{u.email || u.username || "--"}</small></td>
                  <td><b className={Number(u.balance) < 100000 ? "money-out" : "money-tag"}>{money(u.balance)}</b>{Number(u.balance) < 100000 && <small style={{ color: "#ef4444" }}> ⚠️ Thấp</small>}</td>
                  <td><span className="count-tag">{u.vehicleCount} xe</span></td>
                  <td><Pill s={u.isActive ? "active" : "inactive"} /></td>
                  <td><small>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("vi-VN") : "Chưa đăng nhập"}</small></td>
                  <td>
                    <div className="row-actions">
                      <button className="btn-xs btn-primary" onClick={() => { setTopupId(u.id); setMsg(""); }}>💰 Nạp tiền</button>
                      <button className={`btn-xs ${u.isActive ? "btn-err" : "btn-ok"}`} onClick={() => toggleActive(u.id, u.isActive)}>{u.isActive ? "🔒 Khóa" : "🔓 Mở"}</button>
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan="7"><Empty icon="👥" text="Chưa có tài khoản nào." /></td></tr>}
            </tbody>
          </table>
          <Pagination page={page} total={data?.total || 0} limit={15} setPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ─── Transactions view ─── */
function TransactionsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ search, status, page, limit: 20 });
      setData(await req(`/api/dashboard/transactions?${p}`));
    } catch (e) { setMsg(e.message); }
    finally { setLoading(false); }
  }, [search, status, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="animate-fadein">
      <SectionTitle title="Giao dịch thu phí" sub="Lịch sử từ bảng toll_transactions" />
      <Notice msg={msg} onDismiss={() => setMsg("")} />
      <div className="filter-bar">
        <input className="search-input" placeholder="🔍 Tìm biển số, chủ xe..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tất cả trạng thái</option>
          <option value="paid">Đã thanh toán</option><option value="unpaid">Chưa thanh toán</option>
          <option value="manual_review">Cần xét duyệt</option><option value="failed">Lỗi</option>
        </select>
        <span className="count-badge">{data?.total || 0} giao dịch</span>
      </div>
      {loading ? <Loader /> : (
        <>
          <table className="data-table-full">
            <thead><tr><th>Thời gian</th><th>Biển số</th><th>Chủ xe</th><th>Trạm · Làn</th><th>Loại xe</th><th>Phí (VNĐ)</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {data?.transactions?.length ? data.transactions.map((t) => (
                <tr key={t.id} className="table-row-hover">
                  <td><time>{t.passedAt}</time></td>
                  <td><b className="plate-tag">{t.plate}</b></td>
                  <td>{t.owner}</td>
                  <td><small>{t.station} · Làn {t.laneNo || "--"}</small></td>
                  <td>{t.vehicleType}</td>
                  <td><b>{money(t.fee)}</b></td>
                  <td><Pill s={t.status} /></td>
                </tr>
              )) : <tr><td colSpan="7"><Empty icon="💳" text="Chưa có giao dịch." /></td></tr>}
            </tbody>
          </table>
          <Pagination page={page} total={data?.total || 0} limit={20} setPage={setPage} />
        </>
      )}
    </div>
  );
}

/* ─── Lanes view ─── */
function LanesView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = () => {
    setLoading(true);
    req("/api/dashboard/lanes").then(setData).catch((e) => setMsg(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function toggleLane(id, current) {
    try {
      await req(`/api/dashboard/lanes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !current }) });
      setMsg(`✅ Đã cập nhật trạng thái làn.`); load();
    } catch (e) { setMsg(e.message); }
  }

  return (
    <div className="animate-fadein">
      <SectionTitle title="Làn thu phí" sub="Bảng lanes + devices" />
      <Notice msg={msg} onDismiss={() => setMsg("")} />
      {loading ? <Loader /> : (
        <>
          <table className="data-table-full">
            <thead><tr><th>Trạm</th><th>Làn</th><th>Loại</th><th>Hướng</th><th>Camera</th><th>Xe hôm nay</th><th>Đã TT</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>
              {data?.lanes?.length ? data.lanes.map((l) => (
                <tr key={l.id} className="table-row-hover">
                  <td><b>{l.stationName}</b></td>
                  <td><span className="lane-number">{l.laneNo}</span></td>
                  <td>{l.laneType}</td>
                  <td>{l.direction === "in" ? "Vào" : l.direction === "out" ? "Ra" : "2 chiều"}</td>
                  <td><Pill s={l.deviceStatus === "online" ? "online" : "offline"} /></td>
                  <td><b>{Number(l.todayCount || 0).toLocaleString("vi-VN")}</b></td>
                  <td><b>{Number(l.todayPaid || 0).toLocaleString("vi-VN")}</b></td>
                  <td><Pill s={l.isActive ? "active" : "inactive"} /></td>
                  <td><button className={`btn-xs ${l.isActive ? "btn-err" : "btn-ok"}`} onClick={() => toggleLane(l.id, l.isActive)}>{l.isActive ? "Tắt làn" : "Bật làn"}</button></td>
                </tr>
              )) : <tr><td colSpan="9"><Empty icon="🚧" text="Chưa có dữ liệu làn." /></td></tr>}
            </tbody>
          </table>
          {data?.devices?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 className="view-title" style={{ marginBottom: 10, fontSize: 16 }}>Thiết bị trên làn</h3>
              <table className="data-table-full">
                <thead><tr><th>Làn</th><th>Loại</th><th>Tên</th><th>Trạng thái</th><th>Hoạt động cuối</th></tr></thead>
                <tbody>
                  {data.devices.map((d) => (
                    <tr key={d.id} className="table-row-hover">
                      <td>Làn {d.laneId}</td><td>{d.type}</td><td>{d.name || "--"}</td>
                      <td><Pill s={d.status} /></td>
                      <td><small>{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("vi-VN") : "Chưa có"}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Live view ─── */
function LiveView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    req("/api/dashboard/live").then(setData).catch((e) => setMsg(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  return (
    <div className="animate-fadein">
      <SectionTitle title="Camera & Nhận diện biển số" sub="plate_detections – tự động làm mới mỗi 15 giây"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={load}>🔄 Làm mới ngay</button>
            <button className={`btn-ghost`} onClick={() => setAutoRefresh(!autoRefresh)}>
              {autoRefresh ? "⏸ Tạm dừng" : "▶ Tự động mới"}
            </button>
          </div>
        } />
      <Notice msg={msg} onDismiss={() => setMsg("")} />

      {data?.cameras?.length > 0 && (
        <div className="cameras-row">
          {data.cameras.map((c) => (
            <div key={c.id} className={`camera-card ${c.status === "online" ? "cam-online" : "cam-offline"}`}>
              <b>📷 {c.name || `Camera Làn ${c.laneNo}`}</b>
              <span>{c.stationName} · Làn {c.laneNo}</span>
              <Pill s={c.status} />
              <small>{c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleTimeString("vi-VN") : "--"}</small>
            </div>
          ))}
        </div>
      )}

      {loading ? <Loader text="Đang tải dữ liệu nhận diện..." /> : (
        <table className="data-table-full">
          <thead><tr><th>Thời gian</th><th>Trạm · Làn</th><th>Biển số OCR</th><th>Chuẩn hóa</th><th>Loại xe (AI)</th><th>Độ chính xác</th><th>Ảnh</th><th>Xử lý</th></tr></thead>
          <tbody>
            {data?.detections?.length ? data.detections.map((d) => (
              <tr key={d.id} className="table-row-hover">
                <td><time>{d.detectedAt}</time></td>
                <td><small>{d.stationName} · Làn {d.laneNo}</small></td>
                <td><b className="plate-tag">{d.plateRaw || "--"}</b></td>
                <td>{d.plateNormalized || "--"}</td>
                <td>{d.vehicleClass || "--"}</td>
                <td><b style={{ color: parseFloat(d.confidence) >= 0.9 ? "#16a34a" : "#f59e0b" }}>{d.confidenceLabel}</b></td>
                <td>{d.imagePath ? <a href={d.imagePath} target="_blank" rel="noreferrer" className="btn-xs btn-primary">Xem</a> : "–"}</td>
                <td><Pill s={d.processed ? "active" : "pending"} /></td>
              </tr>
            )) : <tr><td colSpan="8"><Empty icon="📷" text="Chưa có dữ liệu nhận diện." /></td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ─── Reports view ─── */
function ReportsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("7");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    req(`/api/dashboard/reports?period=${period}`).then(setData).catch((e) => setMsg(e.message)).finally(() => setLoading(false));
  }, [period]);

  const maxR = data ? Math.max(...data.dailyRevenue.map((i) => Number(i.revenue)), 1) : 1;

  return (
    <div className="animate-fadein">
      <SectionTitle title="Báo cáo thống kê" sub="Phân tích doanh thu & lưu lượng"
        action={
          <select className="period-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="7">7 ngày</option><option value="14">14 ngày</option>
            <option value="30">30 ngày</option><option value="90">90 ngày</option>
          </select>
        } />
      <Notice msg={msg} onDismiss={() => setMsg("")} />
      {loading ? <Loader /> : data && (
        <>
          <div className="report-summary">
            {[
              { label: "Tổng lượt xe", value: Number(data.summary.total || 0).toLocaleString("vi-VN"), color: "blue" },
              { label: "Doanh thu", value: money(data.summary.revenue), color: "green" },
              { label: "Đã thanh toán", value: Number(data.summary.paid || 0).toLocaleString("vi-VN"), color: "purple" },
              { label: "Chưa thanh toán", value: Number(data.summary.unpaid || 0).toLocaleString("vi-VN"), color: "orange" },
            ].map((item) => (
              <div key={item.label} className={`admin-stat-card stat-${item.color}`} style={{ paddingLeft: 18 }}>
                <small>{item.label}</small><strong>{item.value}</strong>
              </div>
            ))}
          </div>
          {data.dailyRevenue.length > 0 && (
            <div className="admin-panel" style={{ marginTop: 16, padding: 18 }}>
              <h3 className="view-title" style={{ marginBottom: 14, fontSize: 16 }}>Doanh thu theo ngày</h3>
              <div className="admin-chart">
                <div className="chart-bars">
                  {data.dailyRevenue.map((item) => (
                    <div key={item.day} className="chart-column" style={{ width: `${85 / data.dailyRevenue.length}%` }}>
                      <div className="bar-value" style={{ height: `${Math.max(5, (Number(item.revenue) / maxR) * 100)}%` }} title={money(item.revenue)} />
                      <small>{item.day}</small>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="report-grid">
            <div className="admin-panel">
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Theo loại xe</h3>
              <table className="data-table-full"><thead><tr><th>Loại xe</th><th>Lượt</th><th>Doanh thu</th></tr></thead>
                <tbody>{data.byVehicleType.map((r) => <tr key={r.vehicleType}><td>{r.vehicleType}</td><td>{Number(r.total).toLocaleString()}</td><td><b>{money(r.revenue)}</b></td></tr>)}</tbody>
              </table>
            </div>
            <div className="admin-panel">
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Theo trạm</h3>
              <table className="data-table-full"><thead><tr><th>Trạm</th><th>Lượt</th><th>Doanh thu</th></tr></thead>
                <tbody>{data.byStation.map((r) => <tr key={r.station}><td>{r.station}</td><td>{Number(r.total).toLocaleString()}</td><td><b>{money(r.revenue)}</b></td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Settings view ─── */
function SettingsView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    setLoading(true);
    req("/api/dashboard/settings").then(setData).catch((e) => setMsg(e.message)).finally(() => setLoading(false));
  }, []);
  return (
    <div className="animate-fadein">
      <SectionTitle title="Cài đặt hệ thống" sub="Trạm, biểu phí, loại phương tiện" />
      <Notice msg={msg} onDismiss={() => setMsg("")} />
      {loading ? <Loader /> : data && (
        <div className="report-grid">
          <div className="admin-panel">
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Trạm thu phí</h3>
            <table className="data-table-full">
              <thead><tr><th>Mã</th><th>Tên trạm</th><th>Địa điểm</th><th>Trạng thái</th></tr></thead>
              <tbody>{data.stations.map((s) => <tr key={s.id}><td>{s.code}</td><td><b>{s.name}</b></td><td>{s.location}</td><td><Pill s={s.is_active ? "active" : "inactive"} /></td></tr>)}</tbody>
            </table>
          </div>
          <div className="admin-panel">
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Biểu phí hiện hành</h3>
            <table className="data-table-full">
              <thead><tr><th>Trạm</th><th>Loại xe</th><th>Phí</th></tr></thead>
              <tbody>{data.rates.slice(0, 15).map((r) => <tr key={r.id}><td>{r.stationName}</td><td>{r.vehicleType}</td><td><b>{Number(r.fee).toLocaleString("vi-VN")} đ</b></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ADMIN DASHBOARD SHELL
───────────────────────────────────────────── */
function AdminDashboard({ user, onLogout }) {
  const [data, setData] = useState(emptyDashboard);
  const [view, setView] = useState("overview");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const initials = useMemo(() =>
    user.displayName.split(/\s+/).filter(Boolean).slice(-2).map((p) => p[0]).join("").toUpperCase(),
    [user.displayName]
  );

  // Reload overview data
  const reloadOverview = useCallback(() => {
    req("/api/dashboard").then(setData).catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => { reloadOverview(); }, [reloadOverview]);

  async function handleUpload(e) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setUploading(true); setNotice(`⟳ Đang tải ${file.name} lên hệ thống...`);
    try {
      const fd = new FormData(); fd.append("media", file);
      const r = await req("/api/dashboard/upload", { method: "POST", body: fd });
      setNotice(`✅ ${r.message} (Mã nhận diện: #${r.detectionId})`);
      reloadOverview();
    } catch (e) { setNotice(e.message); }
    finally { setUploading(false); }
  }

  const MENU = [
    ["overview","⌂","Tổng quan"],["vehicles","🚗","Quản lý phương tiện"],
    ["users","👥","Tài khoản ETC"],["transactions","💳","Giao dịch thu phí"],
    ["lanes","🚦","Làn thu phí"],["live","📷","Camera & Nhận diện"],
    ["reports","📊","Báo cáo thống kê"],["settings","⚙️","Cài đặt hệ thống"],
  ];
  const VIEW_TITLE = {
    overview:"Tổng quan hệ thống", vehicles:"Quản lý phương tiện",
    users:"Tài khoản ETC", transactions:"Giao dịch thu phí",
    lanes:"Làn thu phí", live:"Camera & Nhận diện",
    reports:"Báo cáo thống kê", settings:"Cài đặt hệ thống",
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <span className="admin-logo">〽</span>
          <div><strong>ITS – ETC</strong><small>Hệ thống thu phí thông minh</small></div>
        </div>
        <div className="admin-top-actions">
          <button type="button" onClick={() => setNotice(`⚠️ Có ${data.alerts} cảnh báo cần xử lý.`)}>🔔 <b>{data.alerts}</b></button>
          <span className="admin-avatar">{initials}</span>
          <span><strong>{user.displayName}</strong><small>{user.roleLabel}</small></span>
          <time>{data.generatedAt}</time>
          <button type="button" title="Đăng xuất" onClick={onLogout}>↪ Đăng xuất</button>
        </div>
      </header>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-title">MENU QUẢN TRỊ</div>
          {MENU.map(([key, icon, label]) => (
            <button key={key} type="button"
              className={`admin-menu-item ${view === key ? "active" : ""}`}
              onClick={() => setView(key)}>
              <span>{icon}</span>{label}
            </button>
          ))}
          <div className="admin-sidebar-illustration"><span>ITS</span><small>ETC Smart Traffic System</small></div>
        </aside>
        <main className="admin-content">
          <div className="admin-page-title">
            <div><p>HỆ THỐNG THU PHÍ ĐIỆN TỬ TỰ ĐỘNG</p><h1>{VIEW_TITLE[view]}</h1></div>
            <span>Cập nhật: {data.generatedAt}</span>
          </div>
          {notice && <div className={`admin-notice ${notice.startsWith("✅") ? "notice-ok" : ""}`} onClick={() => setNotice("")} style={{ cursor: "pointer" }}>{notice} ✕</div>}

          {view === "overview" && <OverviewView data={data} setView={setView} onUpload={handleUpload} uploading={uploading} />}
          {view === "vehicles" && <VehiclesView />}
          {view === "users" && <UsersView />}
          {view === "transactions" && <TransactionsView />}
          {view === "lanes" && <LanesView />}
          {view === "live" && <LiveView />}
          {view === "reports" && <ReportsView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   USER PORTAL
───────────────────────────────────────────── */
function UserPortal({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("home");

  const load = useCallback(() => {
    setLoading(true);
    req(`/api/dashboard/user/${user.id}`).then(setData).catch((e) => setNotice(e.message)).finally(() => setLoading(false));
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  const profile = data?.profile;
  const vehicle = data?.vehicles?.[0];
  const txFiltered = (data?.walletTransactions || []).filter((i) =>
    `${i.location} ${i.note}`.toLowerCase().includes(query.toLowerCase())
  );

  const NAV = [["home","🏠","Trang chủ"],["vehicles","🚗","Phương tiện"],["transactions","💳","Giao dịch"],["passages","🏁","Qua trạm"],["notifications","🔔",`Thông báo (${data?.notifications?.length || 0})`]];

  return (
    <div className="user-portal">
      <header className="user-header">
        <Brand />
        <nav>
          {NAV.map(([key, icon, label]) => (
            <button key={key} className={tab === key ? "user-nav-active" : ""} onClick={() => setTab(key)}>{icon} {label}</button>
          ))}
        </nav>
        <div className="user-header-actions">
          <span>👤 {profile?.fullName || "--"}</span>
          <button onClick={onLogout}>Đăng xuất</button>
        </div>
      </header>

      <main className="user-main">
        {/* HOME tab */}
        {tab === "home" && (
          <div className="animate-fadein">
            <div className="user-welcome">
              <div>
                <p className="eyebrow">ITS SMART TRAFFIC · CỔNG KHÁCH HÀNG</p>
                <h1>Xin chào, {profile?.fullName || "--"}!</h1>
                <p>Chúc bạn có những lộ trình thuận lợi hôm nay.</p>
              </div>
              <button className="user-outline-button" onClick={load}>🔄 Làm mới</button>
            </div>
            {notice && <p className="user-notice" onClick={() => setNotice("")}>{notice} ✕</p>}
            {loading ? <Loader /> : (
              <>
                <section className="user-cards">
                  <article className="user-card wallet-card">
                    <h3>💳 Số dư tài khoản ETC</h3>
                    <strong>{`${Number(profile?.balance || 0).toLocaleString("vi-VN")} VNĐ`}</strong>
                    <p>Mã ví: {profile?.accountId ? `ITS-${profile.accountId}` : "Chưa tạo ví"}</p>
                    <p>Trạng thái: {profile?.accountId ? "✅ Hoạt động" : "⚠️ Chưa kích hoạt"}</p>
                    {Number(profile?.balance) < 100000 && <p style={{ fontWeight: 700, color: "#fde68a" }}>⚠️ Số dư thấp! Vui lòng nạp thêm tiền.</p>}
                    <button onClick={() => setNotice("Chức năng nạp tiền sẽ tạo đơn thanh toán qua cổng VNPAY.")}>⚡ Nạp tiền ngay (VNPAY)</button>
                  </article>
                  <article className="user-card vehicle-card">
                    <h3>🚗 Phương tiện & biển số</h3>
                    {vehicle ? <>
                      <strong>{vehicle.plate || "--"}</strong>
                      <p>Loại: {vehicle.vehicleType}</p>
                      <p>Trạng thái: <Pill s={vehicle.status} /></p>
                    </> : <p>Chưa có xe đăng ký.<br /><small>Liên hệ trạm để đăng ký ETC.</small></p>}
                    <button onClick={() => setTab("vehicles")}>📋 Xem tất cả xe →</button>
                  </article>
                  <article className="user-card profile-card">
                    <h3>👤 Thông tin cá nhân</h3>
                    <p>Họ tên: <b>{profile?.fullName || "--"}</b></p>
                    <p>CCCD: {profile?.idNumber || "Chưa cập nhật"}</p>
                    <p>SĐT: {profile?.phone || "Chưa cập nhật"}</p>
                    <p>Email: {profile?.email || "--"}</p>
                    <button onClick={() => setNotice("Chức năng cập nhật hồ sơ đang phát triển.")}>⚙ Cập nhật thông tin</button>
                  </article>
                </section>
                {data?.notifications?.length > 0 && (
                  <div className="user-data-panel" style={{ marginTop: 24 }}>
                    <h2>🔔 Thông báo gần đây</h2>
                    {data.notifications.slice(0, 3).map((n, i) => (
                      <div key={i} className={`notice-item ${n.type}`}>
                        <b>{n.type === "warning" ? "🔴" : "🟢"} {n.title}</b>
                        <p>{n.text}</p>
                      </div>
                    ))}
                    <button className="user-link-button" onClick={() => setTab("notifications")}>Xem tất cả thông báo →</button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* VEHICLES tab */}
        {tab === "vehicles" && (
          <div className="animate-fadein">
            <SectionTitle title="Phương tiện của tôi" sub="Xe đã đăng ký ETC từ bảng vehicles" />
            {loading ? <Loader /> : data?.vehicles?.length ? (
              <div className="user-data-panel">
                <table className="data-table-full">
                  <thead><tr><th>Biển số</th><th>Loại xe</th><th>Trạng thái</th></tr></thead>
                  <tbody>{data.vehicles.map((v) => <tr key={v.id}><td><b className="plate-tag">{v.plate}</b></td><td>{v.vehicleType}</td><td><Pill s={v.status} /></td></tr>)}</tbody>
                </table>
              </div>
            ) : <Empty icon="🚗" text="Chưa có phương tiện đăng ký. Liên hệ trạm thu phí." />}
          </div>
        )}

        {/* TRANSACTIONS tab */}
        {tab === "transactions" && (
          <div className="animate-fadein">
            <div className="user-panel-title" style={{ marginBottom: 16 }}>
              <div><h2>Lịch sử giao dịch</h2><p>Biến động ví từ wallet_transactions</p></div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Tìm trạm, nội dung..." />
            </div>
            {loading ? <Loader /> : (
              <div className="user-data-panel">
                {txFiltered.length ? txFiltered.map((item) => (
                  <div key={item.id} className="user-table-row">
                    <span>{item.createdAt}</span>
                    <span>{item.location}</span>
                    <span className={item.amount < 0 ? "money-out" : "money-in"}>
                      {item.amount < 0 ? "-" : "+"}{`${Math.abs(item.amount).toLocaleString("vi-VN")} VNĐ`}
                    </span>
                    <b>{item.balanceAfter !== undefined ? `${Number(item.balanceAfter).toLocaleString("vi-VN")} VNĐ` : "--"}</b>
                  </div>
                )) : <Empty icon="💳" text="Chưa có giao dịch." />}
              </div>
            )}
          </div>
        )}

        {/* PASSAGES tab */}
        {tab === "passages" && (
          <div className="animate-fadein">
            <SectionTitle title="Lịch sử qua trạm" sub="Từ bảng toll_transactions" />
            {loading ? <Loader /> : (
              <div className="user-data-panel">
                {data?.passages?.length ? data.passages.map((item, i) => (
                  <div key={i} className="user-table-row">
                    <span>{item.passedAt}</span>
                    <span>{item.station} · Làn {item.laneNo || "--"}</span>
                    <span><b className="plate-tag">{item.plate}</b></span>
                    <b className="money-out">-{`${Number(item.fee).toLocaleString("vi-VN")} VNĐ`}</b>
                  </div>
                )) : <Empty icon="🏁" text="Chưa có lịch sử qua trạm." />}
              </div>
            )}
          </div>
        )}

        {/* NOTIFICATIONS tab */}
        {tab === "notifications" && (
          <div className="animate-fadein">
            <SectionTitle title="Thông báo" sub="Cảnh báo tài khoản & hoạt động" />
            <div className="notification-panel">
              {data?.notifications?.length ? data.notifications.map((n, i) => (
                <div key={i} className={`notice-item ${n.type}`}>
                  <b>{n.type === "warning" ? "🔴" : "🟢"} {n.title}</b>
                  <p>{n.text}</p>
                </div>
              )) : <Empty icon="🔔" text="Chưa có thông báo mới." />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────
   APP ROOT
───────────────────────────────────────────── */
export default function App() {
  const [user, setUser] = useState(null);
  if (!user) return <AuthScreen onLogin={setUser} />;
  return user.role === "user"
    ? <UserPortal user={user} onLogout={() => setUser(null)} />
    : <AdminDashboard user={user} onLogout={() => setUser(null)} />;
}
