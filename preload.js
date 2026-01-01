// preload.js
console.log("[preload] loaded");
const { contextBridge, ipcRenderer } = require("electron");
const os = require("os");

function getLanIPv4() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if (n && n.family === "IPv4" && !n.internal) return n.address;
      }
    }
  } catch {}
  return "";
}

const api = {
  // Auth
  login: (data) => {
    const device = {
      hostname: os.hostname(),
      ip: getLanIPv4(),
      platform: process.platform, // win32/darwin/linux
      osType: os.type(), // Windows_NT
      osRelease: os.release(), // 10.0.xxxx
      arch: os.arch(), // x64
      // osVersion: typeof os.version === "function" ? os.version() : "",
    };
    return ipcRenderer.invoke("login", { ...(data || {}), device });
  },
  logout: () => ipcRenderer.invoke("logout"),
  getMe: () => ipcRenderer.invoke("get-me"),

  // Users (admin)
  getUsers: () => ipcRenderer.invoke("get-users"),
  createUser: (user) => ipcRenderer.invoke("create-user", user),
  updateUser: (payload) => ipcRenderer.invoke("update-user", payload),
  deleteUser: (username) => ipcRenderer.invoke("delete-user", username),
  setUserBlocked: (payload) => ipcRenderer.invoke("set-user-blocked", payload),

  // Clients
  getClients: () => ipcRenderer.invoke("get-clients"),
  updateClientName: (payload) =>
    ipcRenderer.invoke("update-client-name", payload),
  deleteClient: (clientId) => ipcRenderer.invoke("delete-client", clientId),

  // Notify
  sendNotify: (payload) => ipcRenderer.invoke("send-notify", payload),
  sendNotifyUser: (payload) => ipcRenderer.invoke("send-notify-user", payload),

  // Logs
  getLogs: (payload) => ipcRenderer.invoke("get-logs", payload),
  exportLogsExcel: (payload) =>
    ipcRenderer.invoke("export-logs-excel", payload),
  getMyLogs: (payload) => ipcRenderer.invoke("get-my-logs", payload),

  // Login logs (ROOT admin only)
  getLoginLogs: (payload) => ipcRenderer.invoke("get-login-logs", payload),
  // Log edit admin
  getAdminAuditLogs: (payload) =>
    ipcRenderer.invoke("get-admin-audit-logs", payload),
  //CALL VERSION APP
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("auth", api);
