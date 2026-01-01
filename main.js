const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const os = require("os");
const path = require("path");
const { connectDB } = require("./js/db");
const { startSocketServer } = require("./js/socket");

let socketApi;
let db;

app.setName("Thông báo");

let loginWindow = null;
let mainWindow = null;
let isLoggingOut = false;

/* ===============================
   SESSION (webContents.id)
================================ */
const sessions = new Map(); // webContentsId => { username, role }

function setSession(win, user) {
  if (!win?.webContents) return;
  const id = win.webContents.id;
  sessions.set(id, { username: user.username, role: user.role });
  win.on("closed", () => sessions.delete(id));
}

function getSession(event) {
  return sessions.get(event.sender.id);
}

function requireLogin(event) {
  const s = getSession(event);
  if (!s) return { ok: false, error: "not_logged_in" };
  return { ok: true, session: s };
}

function requireAdmin(event) {
  const s = getSession(event);
  if (!s) return { ok: false, error: "not_logged_in" };
  if (s.role !== "admin") return { ok: false, error: "forbidden" };
  return { ok: true, session: s };
}

/* ===============================
   HELPERS
================================ */
function escRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// lấy IP v4 LAN (ưu tiên IPv4, không lấy 127.0.0.1)
function getLocalIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (n.family === "IPv4" && !n.internal) return n.address;
      }
    }
  } catch {}
  return "";
}

function buildDeviceMeta() {
  const hostname = os.hostname() || "";
  const ip = getLocalIPv4();
  const osType = os.type() || "";
  const osRelease = os.release() || "";
  const arch = os.arch() || "";
  const platform = process.platform || "";
  const platformLabel = `${osType} ${osRelease}${
    arch ? " " + arch : ""
  }`.trim();

  return { hostname, ip, osType, osRelease, arch, platform, platformLabel };
}

// FILTER
function buildNotifyLogsFilter(payload = {}) {
  const ands = [];

  const q = String(payload?.q || "").trim();
  const by = String(payload?.by || "").trim();
  const client = String(payload?.client || "").trim();

  const fromMs = payload?.fromMs;
  const toMs = payload?.toMs;

  if (q) {
    const rx = new RegExp(escRe(q), "i");
    ands.push({
      $or: [
        { clientId: rx },
        { clientName: rx },
        { clientIp: rx },
        { by: rx },
        { text: rx },
        { status: rx },
      ],
    });
  }

  if (by) {
    ands.push({ by: new RegExp(escRe(by), "i") });
  }

  if (client) {
    const rxC = new RegExp(escRe(client), "i");
    ands.push({ $or: [{ clientId: rxC }, { clientName: rxC }] });
  }

  if (Number.isFinite(fromMs) || Number.isFinite(toMs)) {
    const createdAt = {};
    if (Number.isFinite(fromMs)) createdAt.$gte = new Date(fromMs);
    if (Number.isFinite(toMs)) createdAt.$lte = new Date(toMs);
    ands.push({ createdAt });
  }

  return ands.length ? { $and: ands } : {};
}

async function getClientDisplay(clientId) {
  try {
    const c = await db
      .collection("clients")
      .findOne(
        { clientId },
        { projection: { _id: 0, name: 1, reportedName: 1, ip: 1 } }
      );
    if (!c) return { clientName: "", clientIp: "" };
    return {
      clientName: c.name || c.reportedName || "",
      clientIp: c.ip || "",
    };
  } catch {
    return { clientName: "", clientIp: "" };
  }
}

async function isRootAdmin(username) {
  const u = await db
    .collection("users")
    .findOne({ username }, { projection: { _id: 0, protected: 1 } });
  return !!u?.protected;
}

/* ===============================
   ADMIN AUDIT LOG
================================ */
async function writeAdminAudit({
  by,
  byRole,
  action,
  target,
  targetRole,
  note,
}) {
  try {
    await db.collection("admin_audit_logs").insertOne({
      createdAt: new Date(),
      by: by || "",
      byRole: byRole || "",
      action: action || "",
      target: target || "",
      targetRole: targetRole || "",
      note: note || "",
    });
  } catch (e) {
    console.log("❌ admin_audit_logs insert fail:", e?.message || e);
  }
}

/* ===============================
   WINDOWS
================================ */
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    title: "Đăng nhập",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  loginWindow.loadFile(path.join(__dirname, "ui/login.html"));
}

function createMainWindow(user) {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1280,
    minWidth: 1200,
    minHeight: 720,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  setSession(mainWindow, user);

  if (user.role === "admin")
    mainWindow.loadFile(path.join(__dirname, "ui/admin.html"));
  else mainWindow.loadFile(path.join(__dirname, "ui/index.html"));
}

/* ===============================
   AUTH - LOGIN USER
================================ */
ipcMain.handle("login", async (event, { username, password, device } = {}) => {
  try {
    const u = String(username || "").trim();
    const p = String(password || "").trim();

    if (!u || !p) return { ok: false, error: "missing_fields" };

    // tìm theo username trước để còn tăng fail count
    const user = await db.collection("users").findOne({ username: u });
    if (!user) return { ok: false, error: "invalid_credentials" };

    // user bị block thì không cho login
    if (user.blocked) {
      await writeAdminAudit({
        by: "system",
        byRole: "system",
        action: "login_blocked",
        target: u,
        targetRole: user.role,
        note: "Account is blocked",
      });
      return { ok: false, error: "blocked" };
    }

    const passOk = String(user.password || "") === p;

    if (!passOk) {
      // ROOT/protected: không auto-block
      if (!user.protected) {
        const cur = Number(user.failedLoginCount || 0);
        const next = cur + 1;

        const set = { failedLoginCount: next, failedLoginAt: new Date() };
        if (next >= 3) set.blocked = true;

        await db.collection("users").updateOne({ username: u }, { $set: set });

        if (next >= 3) {
          await writeAdminAudit({
            by: "system",
            byRole: "system",
            action: "auto_block_failed_login",
            target: u,
            targetRole: user.role,
            note: "Failed login >= 3 (auto blocked)",
          });
          return { ok: false, error: "blocked" };
        }
      }

      return { ok: false, error: "invalid_credentials" };
    }

    // login đúng -> reset fail counter
    await db
      .collection("users")
      .updateOne(
        { username: u },
        { $set: { failedLoginCount: 0, failedLoginAt: null } }
      );

    // ✅ FIX: luôn ghi login log bằng device của MAIN (ổn định),
    // rồi merge thêm device từ renderer nếu có
    try {
      const dvLocal = buildDeviceMeta();
      const dvFromRenderer = device && typeof device === "object" ? device : {};
      const dv = { ...dvLocal, ...dvFromRenderer };

      await db.collection("login_logs").insertOne({
        createdAt: new Date(),
        username: u,
        role: user.role || "",
        device: dv,

        // fields top-level để UI render chắc chắn
        deviceName: dv.hostname || dv.deviceName || dv.name || "",
        deviceIp: dv.ip || dv.deviceIp || "",
        platform: dv.platform || dv.osType || "",
        platformLabel:
          dv.platformLabel ||
          `${dv.osType || ""} ${dv.osRelease || ""}${
            dv.arch ? " " + dv.arch : ""
          }`.trim(),
      });
    } catch (e) {
      console.log("⚠️ insert login_logs fail:", e?.message || e);
    }

    createMainWindow(user);

    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.hide();
      setTimeout(() => {
        try {
          loginWindow?.close();
        } catch {}
        loginWindow = null;
      }, 150);
    }

    return { ok: true, role: user.role };
  } catch (e) {
    console.log("❌ IPC login error:", e?.message || e);
    return { ok: false, error: "server_error" };
  }
});

ipcMain.handle("logout", async (event) => {
  isLoggingOut = true;

  sessions.delete(event.sender.id);

  if (!loginWindow || loginWindow.isDestroyed()) createLoginWindow();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }

  isLoggingOut = false;
  return { ok: true };
});

ipcMain.handle("get-me", async (event) => {
  const s = getSession(event);
  if (!s) return { ok: false, error: "not_logged_in" };
  return { ok: true, user: { username: s.username, role: s.role } };
});

/* ===============================
   ADMIN: LOGIN LOGS (ROOT ONLY)
================================ */
ipcMain.handle("get-login-logs", async (event, payload = {}) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const meIsRoot = await isRootAdmin(chk.session.username);
  if (!meIsRoot) return { ok: false, error: "forbidden" };

  const limit = Math.min(2000, Math.max(10, Number(payload?.limit || 200)));
  const q = String(payload?.q || "").trim();

  const filter = {};
  if (q) {
    const rx = new RegExp(escRe(q), "i");
    filter.$or = [
      { username: rx },
      { role: rx },
      { deviceName: rx },
      { deviceIp: rx },
      { platform: rx },
      { platformLabel: rx },
      { "device.hostname": rx },
      { "device.ip": rx },
      { "device.platform": rx },
      { "device.osType": rx },
      { "device.osRelease": rx },
      { "device.arch": rx },
    ];
  }

  const raw = await db
    .collection("login_logs")
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  const logs = raw.map((l) => {
    const d = l.device || {};
    const deviceName = l.deviceName ?? d.hostname ?? d.deviceName ?? "";
    const deviceIp = l.deviceIp ?? d.ip ?? d.deviceIp ?? "";

    const osLabel = `${d.osType || ""} ${d.osRelease || ""}`.trim();
    const platformLabel =
      l.platformLabel ??
      `${osLabel || l.platform || d.platform || ""}${
        d.arch ? " " + d.arch : ""
      }`.trim();

    return { ...l, deviceName, deviceIp, platformLabel };
  });

  return { ok: true, logs };
});

/* ===============================
   ADMIN: AUDIT LOGS (ROOT ONLY)
================================ */
ipcMain.handle("get-admin-audit-logs", async (event, payload = {}) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const meIsRoot = await isRootAdmin(chk.session.username);
  if (!meIsRoot) return { ok: false, error: "forbidden" };

  const limit = Math.min(2000, Math.max(10, Number(payload?.limit || 200)));

  const logs = await db
    .collection("admin_audit_logs")
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return { ok: true, logs };
});

/* ===============================
   SEND NOTIFY (ADMIN)
================================ */
ipcMain.handle("send-notify", async (event, { clientId, text, duration }) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const cid = String(clientId || "").trim();
  const msgText = String(text || "");
  const dur = Number(duration || 30);

  if (!cid) return { ok: false, error: "missing_clientId" };

  const { clientName, clientIp } = await getClientDisplay(cid);

  let ok = false;
  let status = "sent";

  try {
    ok = socketApi?.send(cid, {
      title: "Thông báo",
      text: msgText,
      duration: dur,
    });
    if (!ok) status = "client_offline";
  } catch (e) {
    ok = false;
    status = "error";
    console.log("❌ send-notify(admin) error:", e?.message || e);
  }

  try {
    await db.collection("notify_logs").insertOne({
      createdAt: new Date(),
      by: chk.session.username,
      clientId: cid,
      clientName,
      clientIp,
      text: msgText,
      duration: dur,
      status,
    });
  } catch (e) {
    console.log("❌ insert notify_logs fail:", e?.message || e);
  }

  if (!ok) return { ok: false, error: status };
  return { ok: true };
});

/* ===============================
   SEND NOTIFY (USER)
================================ */
ipcMain.handle(
  "send-notify-user",
  async (event, { clientId, text, duration }) => {
    const chk = requireLogin(event);
    if (!chk.ok) return chk;

    const cid = String(clientId || "").trim();
    const msgText = String(text || "");
    const dur = Number(duration || 30);

    if (!cid) return { ok: false, error: "missing_clientId" };

    const { clientName, clientIp } = await getClientDisplay(cid);

    let ok = false;
    let status = "sent";

    try {
      ok = socketApi?.send(cid, {
        title: "Thông báo",
        text: msgText,
        duration: dur,
      });
      if (!ok) status = "client_offline";
    } catch (e) {
      ok = false;
      status = "error";
      console.log("❌ send-notify(user) error:", e?.message || e);
    }

    try {
      await db.collection("notify_logs").insertOne({
        createdAt: new Date(),
        by: chk.session.username,
        clientId: cid,
        clientName,
        clientIp,
        text: msgText,
        duration: dur,
        status,
      });
    } catch (e) {
      console.log("❌ insert notify_logs fail:", e?.message || e);
    }

    if (!ok) return { ok: false, error: status };
    return { ok: true };
  }
);

/* ===============================
   USER LOGS
================================ */
ipcMain.handle("get-my-logs", async (event, payload = {}) => {
  const chk = requireLogin(event);
  if (!chk.ok) return chk;

  const days = Math.min(30, Math.max(1, Number(payload?.days || 7)));
  const limit = Math.min(1000, Math.max(10, Number(payload?.limit || 200)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await db
    .collection("notify_logs")
    .find(
      { by: chk.session.username, createdAt: { $gte: since } },
      { projection: { _id: 0 } }
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return { ok: true, logs };
});

/* ===============================
   ADMIN: USERS CRUD
================================ */
ipcMain.handle("get-users", async (event) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const meIsRoot = await isRootAdmin(chk.session.username);

  const users = await db
    .collection("users")
    .find(
      {},
      {
        projection: {
          _id: 0,
          username: 1,
          role: 1,
          protected: 1,
          blocked: 1,
          createdAt: 1,
          createdBy: 1,
          updatedAt: 1,
          updatedBy: 1,
        },
      }
    )
    .sort({ createdAt: -1 })
    .toArray();

  // ✅ ẨN ROOT với admin thường
  const visibleUsers = meIsRoot ? users : users.filter((u) => !u.protected);

  return { ok: true, users: visibleUsers, me: chk.session.username, meIsRoot };
});

ipcMain.handle("create-user", async (event, user) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const meIsRoot = await isRootAdmin(chk.session.username);

  const { username, password, role } = user || {};
  const u = String(username || "").trim();
  const p = String(password || "").trim();
  const r = role === "admin" ? "admin" : "user";

  if (!u || !p) return { ok: false, error: "missing_fields" };
  if (r === "admin" && !meIsRoot)
    return { ok: false, error: "only_root_can_create_admin" };

  const existed = await db.collection("users").findOne({ username: u });
  if (existed) return { ok: false, error: "exists" };

  await db.collection("users").insertOne({
    username: u,
    password: p,
    role: r,
    blocked: false,
    failedLoginCount: 0,
    failedLoginAt: null,
    createdAt: new Date(),
    createdBy: chk.session.username,
  });

  // ✅ audit
  await writeAdminAudit({
    by: chk.session.username,
    byRole: chk.session.role,
    action: "create_user",
    target: u,
    targetRole: r,
    note: "",
  });

  return { ok: true };
});

ipcMain.handle("update-user", async (event, payload) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const me = chk.session.username;
  const meIsRoot = await isRootAdmin(me);

  const { username, role, password } = payload || {};
  const u = String(username || "").trim();
  if (!u) return { ok: false, error: "missing_username" };

  // lấy target để check quyền
  const target = await db
    .collection("users")
    .findOne(
      { username: u },
      { projection: { _id: 0, username: 1, role: 1, protected: 1 } }
    );
  if (!target) return { ok: false, error: "not_found" };

  // admin thường không được sửa admin khác (trừ khi sửa chính mình)
  if (!meIsRoot && target.role === "admin" && u !== me) {
    return { ok: false, error: "cannot_edit_admin" };
  }

  const updates = {};

  // ====== ROLE RULES ======
  if (role === "admin" || role === "user") {
    // không được tự hạ role của chính mình
    if (u === me && role !== "admin") {
      return { ok: false, error: "cannot_change_own_role" };
    }

    // admin thường không được nâng ai lên admin
    if (!meIsRoot && role === "admin" && target.role !== "admin") {
      return { ok: false, error: "only_root_can_promote_admin" };
    }

    // ROOT protected không nên bị đổi role (an toàn)
    if (target.protected) {
      return { ok: false, error: "protected_user" };
    }

    updates.role = role;
  }

  // ====== PASSWORD RULES ======
  if (typeof password === "string" && password.trim() !== "") {
    updates.password = password.trim();
  }

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: "nothing_to_update" };
  }

  updates.updatedAt = new Date();
  updates.updatedBy = me;

  const res = await db
    .collection("users")
    .updateOne({ username: u }, { $set: updates });

  if (res.matchedCount === 0) return { ok: false, error: "not_found" };

  // ✅ audit: đổi pass / role
  if (updates.password) {
    await writeAdminAudit({
      by: me,
      byRole: chk.session.role,
      action: "change_password",
      target: u,
      targetRole: target.role,
      note: "",
    });
  }
  if (updates.role && updates.role !== target.role) {
    await writeAdminAudit({
      by: me,
      byRole: chk.session.role,
      action: "change_role",
      target: u,
      targetRole: updates.role,
      note: `${target.role} -> ${updates.role}`,
    });
  }

  return { ok: true };
});

ipcMain.handle("set-user-blocked", async (event, payload) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const username = String(payload?.username || "").trim();
  const blocked = !!payload?.blocked;

  if (!username) return { ok: false, error: "missing_username" };

  // không tự block mình (tránh tự khóa)
  if (username === chk.session.username) {
    return { ok: false, error: "cannot_block_self" };
  }

  const meIsRoot = await isRootAdmin(chk.session.username);

  const target = await db.collection("users").findOne(
    { username },
    {
      projection: {
        _id: 0,
        username: 1,
        role: 1,
        protected: 1,
        failedLoginCount: 1,
        failedLoginAt: 1,
      },
    }
  );
  if (!target) return { ok: false, error: "not_found" };

  // ROOT protected không ai được block
  if (target.protected) return { ok: false, error: "protected_user" };

  // admin thường không được block admin khác
  if (!meIsRoot && target.role === "admin") {
    return { ok: false, error: "cannot_block_admin" };
  }

  // ✅ set blocked + reset fail counter nếu UNBLOCK
  await db.collection("users").updateOne(
    { username },
    {
      $set: {
        blocked,
        failedLoginCount: blocked
          ? Math.max(Number(target.failedLoginCount || 0), 3)
          : 0,
        failedLoginAt: blocked ? target.failedLoginAt || new Date() : null,
        updatedAt: new Date(),
        updatedBy: chk.session.username,
      },
    }
  );

  // ✅ audit
  await writeAdminAudit({
    by: chk.session.username,
    byRole: chk.session.role,
    action: blocked ? "block_user" : "unblock_user",
    target: username,
    targetRole: target.role,
    note: "",
  });

  return { ok: true };
});

ipcMain.handle("delete-user", async (event, username) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const meIsRoot = await isRootAdmin(chk.session.username);
  if (!meIsRoot) return { ok: false, error: "only_root_can_delete" };

  const u = String(username || "").trim();
  if (!u) return { ok: false, error: "missing_username" };

  if (u === chk.session.username)
    return { ok: false, error: "cannot_delete_self" };

  const target = await db
    .collection("users")
    .findOne(
      { username: u },
      { projection: { _id: 0, username: 1, role: 1, protected: 1 } }
    );
  if (!target) return { ok: false, error: "not_found" };

  // ROOT/protected không ai xóa được
  if (target.protected) return { ok: false, error: "protected_user" };

  await db.collection("users").deleteOne({ username: u });

  // ✅ audit
  await writeAdminAudit({
    by: chk.session.username,
    byRole: chk.session.role,
    action: "delete_user",
    target: u,
    targetRole: target.role,
    note: "",
  });

  return { ok: true };
});

/* ===============================
   CLIENTS
================================ */
ipcMain.handle("get-clients", async (event) => {
  const chk = requireLogin(event);
  if (!chk.ok) return chk;

  await db
    .collection("clients")
    .updateMany(
      { online: true, lastSeen: { $lt: new Date(Date.now() - 30 * 1000) } },
      { $set: { online: false, updatedAt: new Date() } }
    );

  const clients = await db
    .collection("clients")
    .find(
      {},
      {
        projection: {
          _id: 0,
          clientId: 1,
          name: 1,
          reportedName: 1,
          online: 1,
          ip: 1,
          lastSeen: 1,
        },
      }
    )
    .sort({ online: -1, lastSeen: -1 })
    .toArray();

  return { ok: true, clients };
});

ipcMain.handle("update-client-name", async (event, payload) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const clientId = String(payload?.clientId || "").trim();
  const name = String(payload?.name || "").trim();
  if (!clientId || !name) return { ok: false, error: "missing_fields" };

  await db
    .collection("clients")
    .updateOne(
      { clientId },
      { $set: { name, updatedAt: new Date(), updatedBy: chk.session.username } }
    );
  return { ok: true };
});

ipcMain.handle("delete-client", async (event, clientId) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const id = String(clientId || "").trim();
  if (!id) return { ok: false, error: "missing_clientId" };

  await db.collection("clients").deleteOne({ clientId: id });
  return { ok: true };
});

/* ===============================
   ADMIN: LOGS + EXPORT
================================ */
ipcMain.handle("get-logs", async (event, payload = {}) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  const limit = Math.min(5000, Math.max(10, Number(payload?.limit || 200)));
  const filter = buildNotifyLogsFilter(payload);

  const logs = await db
    .collection("notify_logs")
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return { ok: true, logs };
});

ipcMain.handle("export-logs-excel", async (event, payload = {}) => {
  const chk = requireAdmin(event);
  if (!chk.ok) return chk;

  let ExcelJS;
  try {
    ExcelJS = require("exceljs");
  } catch {
    return { ok: false, error: "missing_exceljs" };
  }

  const q = String(payload?.q || "").trim();
  const maxRows = Math.min(
    20000,
    Math.max(100, Number(payload?.maxRows || 5000))
  );

  const filter = buildNotifyLogsFilter(payload);
  if (q) {
    const rx = new RegExp(escRe(q), "i");
    filter.$or = [
      { clientId: rx },
      { clientName: rx },
      { clientIp: rx },
      { by: rx },
      { text: rx },
      { status: rx },
    ];
  }

  const rows = await db
    .collection("notify_logs")
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(maxRows)
    .toArray();

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Xuất log ra Excel",
    defaultPath: `notify_logs_${Date.now()}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });

  if (canceled || !filePath) return { ok: false, error: "canceled" };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Logs");

  ws.columns = [
    { header: "Thời gian", key: "createdAt", width: 22 },
    { header: "Người gửi", key: "by", width: 16 },
    { header: "ClientId", key: "clientId", width: 18 },
    { header: "Name", key: "clientName", width: 22 },
    { header: "IP", key: "clientIp", width: 16 },
    { header: "Duration(s)", key: "duration", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Nội dung", key: "text", width: 60 },
  ];

  rows.forEach((r) => {
    ws.addRow({
      createdAt: r.createdAt
        ? new Date(r.createdAt).toLocaleString("vi-VN")
        : "",
      by: r.by || "",
      clientId: r.clientId || "",
      clientName: r.clientName || "",
      clientIp: r.clientIp || "",
      duration: r.duration ?? "",
      status: r.status || "",
      text: r.text || "",
    });
  });

  ws.getRow(1).font = { bold: true };
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };

  await wb.xlsx.writeFile(filePath);
  return { ok: true, filePath };
});

// CALL VERSION APP//
ipcMain.handle("get-app-version", async () => app.getVersion());

/* ===============================
   APP READY
================================ */
app.whenReady().then(async () => {
  db = await connectDB();

  const TTL_DAYS = 180;
  const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

  try {
    await db
      .collection("notify_logs")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });
  } catch (e) {
    console.log("⚠️ createIndex notify_logs TTL fail:", e?.message || e);
  }

  try {
    await db
      .collection("login_logs")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });
  } catch (e) {
    console.log("⚠️ createIndex login_logs TTL fail:", e?.message || e);
  }

  try {
    await db
      .collection("admin_audit_logs")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS });
  } catch (e) {
    console.log("⚠️ createIndex admin_audit_logs TTL fail:", e?.message || e);
  }

  await db
    .collection("users")
    .updateOne(
      { username: "admin" },
      { $set: { protected: true, blocked: false } }
    );

  socketApi = startSocketServer(db, 3000);
  createLoginWindow();
});

app.on("window-all-closed", (e) => {
  if (isLoggingOut) return;
  if (process.platform !== "darwin") app.quit();
});
