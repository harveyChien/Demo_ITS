const shell = document.querySelector(".shell");
const dashboard = document.querySelector("#dashboard");
const roleButtons = document.querySelectorAll(".role-btn");
const loginForm = document.querySelector("#loginForm");
const password = document.querySelector("#password");
const passwordToggle = document.querySelector(".password-toggle");
const formMessage = document.querySelector("#formMessage");
const logoutButton = document.querySelector("#logoutBtn");
const dashboardRole = document.querySelector("#dashboardRole");
const authTabs = document.querySelectorAll(".auth-tab");
const identifierLabel = document.querySelector("#identifierLabel");
const authSubmit = document.querySelector("#authSubmit");
const authHelpText = document.querySelector("#authHelpText");
const registerFields = document.querySelectorAll(".auth-register-only");
const verifyForm = document.querySelector("#verifyForm");
const verifyMessage = document.querySelector("#verifyMessage");
const forgotPasswordLink = document.querySelector("#forgotPasswordLink");
let pendingVerificationEmail = "";

let selectedRole = "user";
let authMode = "login";

const api = {
  async login(credentials) {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return parseApiResponse(response, "Đăng nhập không thành công.");
  },
  async register(credentials) {
    const response = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return parseApiResponse(response, "Đăng ký không thành công.");
  },
  async verifyEmail(credentials) {
    const response = await request("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return parseApiResponse(response, "Kích hoạt không thành công.");
  },
  async dashboard() {
    const response = await request("/api/dashboard");
    return parseApiResponse(response, "Không thể tải dữ liệu hệ thống.");
  },
};

async function request(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(
      "Không thể kết nối backend. Hãy mở website bằng http://localhost:3000 và kiểm tra backend đang chạy.",
    );
  }
}

async function parseApiResponse(response, fallbackMessage) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || fallbackMessage);
  }
  return result;
}

roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedRole = button.dataset.role;
    if (selectedRole === "admin" && authMode === "register") {
      setAuthMode("login");
    }
    roleButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    setAuthMode(authMode);
  });
});

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
});

function setAuthMode(mode) {
  if (selectedRole === "admin" && mode === "register") {
    mode = "login";
  }
  authMode = mode;
  const isRegister = mode === "register";
  const registerTab = document.querySelector('[data-auth-mode="register"]');
  registerTab.hidden = selectedRole === "admin";
  authTabs.forEach((tab) => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  registerFields.forEach((field) => field.classList.toggle("hidden", !isRegister));
  document.querySelector("#displayName").required = isRegister;
  document.querySelector("#confirmPassword").required = isRegister;
  identifierLabel.textContent = selectedRole === "admin" ? "Tài khoản Admin được cấp" : "Email User";
  document.querySelector("#email").type = selectedRole === "admin" ? "text" : "email";
  document.querySelector("#email").placeholder =
    selectedRole === "admin" ? "Nhập tài khoản Admin" : "Nhập email User";
  authSubmit.querySelector("span").textContent = isRegister ? "Tạo tài khoản User" : "Đăng nhập";
  authHelpText.textContent = isRegister
    ? "Tài khoản User đăng ký bằng email. Tài khoản Admin chỉ được cấp riêng."
    : "Tài khoản Admin được cấp riêng bởi quản trị hệ thống.";
}

passwordToggle.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  passwordToggle.textContent = visible ? "Ẩn" : "Hiện";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.checkValidity()) {
    formMessage.textContent = "Vui lòng kiểm tra lại thông tin đăng nhập.";
    loginForm.reportValidity();
    return;
  }

  formMessage.textContent = "Đang xác thực...";
  const formData = new FormData(loginForm);
  try {
    const identifier = formData.get("identifier");
    const plainPassword = formData.get("password");
    let session;
    if (authMode === "register") {
      if (selectedRole !== "user") throw new Error("Chỉ User mới được tự đăng ký bằng email.");
      if (plainPassword !== formData.get("confirmPassword")) {
        throw new Error("Mật khẩu xác nhận không khớp.");
      }
      session = await api.register({
        email: identifier,
        password: plainPassword,
        displayName: formData.get("displayName"),
      });
      pendingVerificationEmail = identifier;
      verifyForm.classList.remove("hidden");
      formMessage.textContent = "Mã kích hoạt đã được gửi tới Gmail của bạn.";
      return;
    } else {
      session = await api.login({
        identifier,
        password: plainPassword,
        role: selectedRole,
      });

    }
    dashboardRole.textContent = session.user.roleLabel;
    document.querySelector(".admin-only").style.display =
      session.user.role === "admin" ? "flex" : "none";
    shell.classList.add("hidden");
    dashboard.classList.remove("hidden");
    await renderDashboard(await api.dashboard(), session.user);
  } catch (error) {
    formMessage.textContent = error.message;
  }
});

verifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  verifyMessage.textContent = "Đang kiểm tra mã...";
  try {
    await api.verifyEmail({
      email: pendingVerificationEmail,
      code: new FormData(verifyForm).get("activationCode"),
    });
    verifyMessage.textContent = "Kích hoạt thành công. Bạn có thể đăng nhập.";
    verifyForm.classList.add("hidden");
    setAuthMode("login");
  } catch (error) {
    verifyMessage.textContent = error.message;
  }
});

async function renderDashboard(data, sessionUser) {
  const displayName = sessionUser?.displayName || "Người dùng";
  document.querySelector("#dashboardName").textContent = displayName;
  document.querySelector("#dashboardAvatar").textContent = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  document.querySelector("#pageHeading").innerHTML = `
    <div><p class="eyebrow">HỆ THỐNG THU PHÍ THÔNG MINH</p><h2>Giám sát làn xe</h2>
    <p>Dữ liệu được cập nhật trực tiếp từ hệ thống nhận diện và cơ sở dữ liệu.</p></div>
    <span class="dashboard-date">${data.generatedAt}</span>`;

  const live = data.live;
  document.querySelector("#dashboardOverview").innerHTML = `
    <section class="monitor-panel">
      <div class="panel-heading"><div><h3>Làn xe giám sát</h3><p>${live.stationName} · Làn ${live.laneNo}</p></div><span class="online-badge">${live.deviceStatus}</span></div>
      <div class="live-camera ${live.imagePath ? "has-image" : ""}" ${live.imagePath ? `style="background-image:url('${live.imagePath}')"` : ""}>
        <div class="camera-placeholder">${live.imagePath ? "" : "Chưa có hình ảnh camera"}</div>
        <div class="camera-overlay"><span>LIVE</span><span>${live.detectedAt}</span></div>
        <div class="detection-box"><b>${live.plate || "--"}</b><small>${live.confidence}</small></div>
      </div>
      <div class="camera-controls"><button type="button" data-camera-action="snapshot">Chụp ảnh</button><button type="button" data-camera-action="video">Tải video mô phỏng</button><button type="button" data-camera-action="toggle-scan">Tự động quét <b class="switch-on">ON</b></button></div>
      <div class="barrier-row"><span>Trạng thái Barrier</span><strong>${live.barrierStatus}</strong><i class="barrier-light ${live.barrierStatus === "ĐANG MỞ" ? "open" : ""}"></i></div>
      <div class="recent-log"><h4>Nhật ký làn xe gần nhất</h4>${data.recentDetections.length ? data.recentDetections.map((item) => `<div><time>${item.detectedAt}</time><b>${item.plate}</b><span>${item.vehicleClass}</span><em>${item.confidence}</em></div>`).join("") : `<p class="empty-state">Chưa có dữ liệu nhận diện từ cơ sở dữ liệu.</p>`}</div>
    </section>
    <section class="admin-panel">
      <div class="panel-heading"><div><h3>Cổng quản trị trung tâm</h3><p>Tổng quan doanh thu và hoạt động</p></div><span class="notification">Thông báo ${data.alerts}</span></div>
      <div class="summary-cards">${data.summary.map((item) => `<div class="summary-card ${item.color}"><small>${item.label}</small><strong>${item.value}</strong><span>${item.note}</span></div>`).join("")}</div>
      <div class="table-block"><div class="table-title"><h4>Danh sách phương tiện đăng ký</h4><span>${data.registeredVehicles.length} bản ghi</span></div><div class="data-table">${data.registeredVehicles.length ? data.registeredVehicles.map((item) => `<div class="table-row"><b>${item.plate}</b><span>${item.owner}</span><span>${item.vehicleType}</span><span>${item.status}</span></div>`).join("") : `<p class="empty-state">Chưa có phương tiện trong cơ sở dữ liệu.</p>`}</div></div>
      <div class="table-block"><div class="table-title"><h4>Lịch sử giao dịch gần đây</h4><span>${data.transactions.length} bản ghi</span></div><div class="data-table">${data.transactions.length ? data.transactions.map((item) => `<div class="table-row"><b>${item.plate}</b><span>${item.owner}</span><span>${item.fee}</span><span>${item.status}</span></div>`).join("") : `<p class="empty-state">Chưa có giao dịch trong cơ sở dữ liệu.</p>`}</div></div>
    </section>`;
}

document.querySelectorAll(".menu-item").forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    document.querySelectorAll(".menu-item").forEach((menuItem) => menuItem.classList.remove("active"));
    item.classList.add("active");
    const viewLabels = {
      overview: "Bảng điều khiển",
      live: "Giám sát trực tiếp",
      vehicles: "Phương tiện",
      transactions: "Lịch sử giao dịch",
      users: "Người dùng & quyền",
    };
    const heading = document.querySelector("#pageHeading h2");
    const description = document.querySelector("#pageHeading p:last-child");
    if (heading) heading.textContent = viewLabels[item.dataset.view] || "Bảng điều khiển";
    if (description) {
      description.textContent = item.dataset.view === "overview"
        ? "Dữ liệu được cập nhật trực tiếp từ hệ thống nhận diện và cơ sở dữ liệu."
        : "Chức năng này đang sử dụng dữ liệu từ các bảng tương ứng trong MySQL.";
    }
  });
});

document.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-camera-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.cameraAction;
  if (action === "toggle-scan") {
    const indicator = actionButton.querySelector(".switch-on");
    const isOn = indicator.textContent === "ON";
    indicator.textContent = isOn ? "OFF" : "ON";
    indicator.classList.toggle("switch-off", isOn);
    return;
  }
  const message = action === "snapshot"
    ? "Chụp ảnh cần camera hoặc dịch vụ AI đang kết nối."
    : "Chưa có video camera để tải xuống.";
  const status = document.querySelector(".barrier-row");
  if (status) {
    const notice = document.createElement("p");
    notice.className = "camera-notice";
    notice.textContent = message;
    status.after(notice);
    window.setTimeout(() => notice.remove(), 3500);
  }
});

logoutButton.addEventListener("click", () => {
  dashboard.classList.add("hidden");
  shell.classList.remove("hidden");
  loginForm.reset();
  formMessage.textContent = "";
});

forgotPasswordLink.addEventListener("click", (event) => {
  event.preventDefault();
  formMessage.textContent = selectedRole === "admin"
    ? "Vui lòng liên hệ quản trị hệ thống để đặt lại mật khẩu Admin."
    : "Chức năng đặt lại mật khẩu sẽ gửi hướng dẫn tới email sau khi API được bật.";
});
