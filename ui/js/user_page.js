// ui/js/user_page.js
(() => {
  const DEFAULT_DURATION_SEC = 20;

  // =========================
  // DOM helpers
  // =========================
  const $ = (id) => document.getElementById(id);

  const els = {
    // modal
    msgOverlay: null,
    msgText: null,
    msgOk: null,

    // user ui
    meName: null,
    logoutBtn: null,

    // clients
    btnRefreshClients: null,
    searchClient: null,
    clientList: null,

    // compose
    editor: null,
    sendBtn: null,
    emojiBtn: null,

    // selected bar
    selectedClientName: null,
    selectedClientStatus: null,

    // logs
    logList: null,
  };

  function cacheEls() {
    els.msgOverlay = $("msgOverlay");
    els.msgText = $("msgText");
    els.msgOk = $("msgOk");

    els.meName = $("meName");
    els.logoutBtn = $("logoutBtn");

    els.btnRefreshClients = $("btnRefreshClients");
    els.searchClient = $("searchClient");
    els.clientList = $("clientList");

    els.editor = $("msg");
    els.sendBtn = $("sendBtn");
    els.emojiBtn = $("emojiBtn");

    els.selectedClientName = $("selectedClientName");
    els.selectedClientStatus = $("selectedClientStatus");

    els.logList = $("logList");
  }

  // =========================
  // Safe utils
  // =========================
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function safeText(el, v) {
    if (el) el.textContent = v ?? "";
  }

  function setPill(el, online) {
    if (!el) return;
    el.classList.toggle("on", !!online);
    el.classList.toggle("off", !online);
    el.textContent = online ? "ONLINE" : "OFFLINE";
  }

  function pickName(x) {
    if (!x) return "";
    if (typeof x === "string") return x.trim();
    if (typeof x === "number") return String(x);
    if (typeof x !== "object") return "";
    return (
      pickName(x.username) ||
      pickName(x.name) ||
      pickName(x.displayName) ||
      pickName(x.me?.username) ||
      pickName(x.me?.name) ||
      pickName(x.user?.username) ||
      pickName(x.user?.name) ||
      ""
    );
  }

  function extractLogs(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.logs)) return payload.logs;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  }

  // =========================
  // Modal message
  // =========================
  let focusAfterMsg = null;

  function showMsg(message, focusEl) {
    focusAfterMsg = focusEl || els.editor || document.body;
    if (els.msgText) els.msgText.textContent = message || "";
    if (els.msgOverlay) els.msgOverlay.style.display = "flex";
    setTimeout(() => els.msgOk?.focus?.(), 0);
  }

  function closeMsg() {
    if (els.msgOverlay) els.msgOverlay.style.display = "none";
    const t = focusAfterMsg || els.editor;
    focusAfterMsg = null;
    setTimeout(() => t?.focus?.(), 0);
  }

  function bindModal() {
    els.msgOk?.addEventListener("click", closeMsg);

    els.msgOverlay?.addEventListener("click", (e) => {
      if (e.target === els.msgOverlay) closeMsg();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.msgOverlay?.style.display === "flex") {
        e.preventDefault();
        closeMsg();
      }
    });
  }

  // =========================
  // State (SINGLE SELECT)
  // =========================
  let clientsCache = [];
  let selectedClientId = ""; // ✅ single-select: chỉ 1 id
  let selectedClientOnline = false;
  let selectedClientLabel = "Chưa chọn";
  let currentUsername = "";

  function clientLabel(c) {
    return (c?.name || c?.reportedName || c?.clientId || "").trim();
  }

  function applySelectionUI() {
    safeText(els.selectedClientName, selectedClientLabel);
    setPill(els.selectedClientStatus, selectedClientOnline);

    // ✅ logic giữ nguyên: chỉ cho gửi khi đã chọn client VÀ client ONLINE
    const ok = !!selectedClientId && !!selectedClientOnline;

    if (els.editor) {
      els.editor.classList.toggle("disabled", !ok);
      els.editor.setAttribute("contenteditable", ok ? "true" : "false");
    }
    if (els.sendBtn) els.sendBtn.disabled = !ok;
  }

  // =========================
  // Clients
  // =========================
  function renderClients(items) {
    if (!els.clientList) return;

    const q = (els.searchClient?.value || "").trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((c) => {
          const s = `${c.clientId || ""} ${c.name || ""} ${
            c.reportedName || ""
          } ${c.ip || ""}`.toLowerCase();
          return s.includes(q);
        });

    els.clientList.innerHTML = "";

    filtered.forEach((c, idx) => {
      const tr = document.createElement("tr");
      if (c.clientId === selectedClientId) tr.classList.add("selected");

      const st = c.online
        ? `<span class="status-online">Online</span>`
        : `<span class="status-offline">Offline</span>`;

      const label = clientLabel(c);
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td title="${escapeHtml(label)}">${escapeHtml(label)}</td>
        <td>${st}</td>
        <td>
          <button class="ghost" data-act="pick" data-id="${escapeHtml(
            c.clientId
          )}">Chọn</button>
        </td>
      `;
      els.clientList.appendChild(tr);
    });
  }

  async function refreshClients() {
    try {
      const r = await window.api?.getClients?.();
      if (!r?.ok) return;

      clientsCache = r.clients || [];
      renderClients(clientsCache);

      // ✅ giữ trạng thái chọn 1 máy; cập nhật online/label theo list mới
      if (selectedClientId) {
        const found = clientsCache.find((x) => x.clientId === selectedClientId);
        if (found) {
          selectedClientOnline = !!found.online;
          selectedClientLabel = clientLabel(found) || selectedClientId;
        } else {
          selectedClientId = "";
          selectedClientOnline = false;
          selectedClientLabel = "Chưa chọn";
        }
        applySelectionUI();
      }
    } catch (e) {
      console.log("refreshClients error", e);
    }
  }

  // =========================
  // Logs
  // =========================
  function logItemHTML(l) {
    const t = l?.createdAt ? new Date(l.createdAt).toLocaleString("vi-VN") : "";
    const status = (l?.status || "").toUpperCase();
    const who = l?.by || "";
    const client = (l?.clientName || "").trim() || l?.clientId || "";
    const ip = l?.clientIp || "";

    const meta = `${t}${status ? " • " + status : ""}${who ? " • " + who : ""}${
      client ? " • " + client : ""
    }${ip ? " • " + ip : ""}`;

    const text = (l?.text || "").toString().trim().replace(/\s+/g, " ");

    return `
      <div class="log-item">
        <div class="log-meta">${escapeHtml(meta)}</div>
        <div class="log-text">${escapeHtml(text)}</div>
      </div>
    `;
  }

  async function loadMeName() {
    const api = window.api;
    if (!api) return "";
    const fns = ["getMe", "whoami", "me", "profile", "getProfile"];
    for (const fn of fns) {
      if (typeof api[fn] !== "function") continue;
      try {
        const r = await api[fn]();
        const name = pickName(r);
        if (name) return name;
      } catch {}
    }
    return "";
  }

  async function fetchLogs() {
    const api = window.api;
    if (!api) return [];

    const fns = ["getMyLogs", "getUserLogs", "getLogs"];
    for (const fn of fns) {
      if (typeof api[fn] !== "function") continue;

      const argsList = [
        undefined,
        { limit: 5000 },
        selectedClientId
          ? { q: selectedClientId, limit: 5000 }
          : { limit: 5000 },
        selectedClientId
          ? { clientId: selectedClientId, limit: 5000 }
          : { limit: 5000 },
      ];

      for (const args of argsList) {
        try {
          const res =
            args === undefined ? await api[fn]() : await api[fn](args);
          if (res?.ok === false) continue;
          const logs = extractLogs(res);
          if (logs.length) return logs;
        } catch {}
      }
    }
    return [];
  }

  async function refreshLogs() {
    if (!els.logList) return;

    let logs = await fetchLogs();

    // giữ nguyên logic cũ: nếu có currentUsername và log có field by -> lọc theo by
    if (currentUsername && logs.some((l) => l && "by" in l)) {
      const filtered = logs.filter((l) => (l.by || "") === currentUsername);
      if (filtered.length) logs = filtered;
    }

    logs.sort((a, b) => {
      const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    els.logList.innerHTML = logs.map(logItemHTML).join("");
  }

  // =========================
  // Send notify
  // =========================
  async function trySendNotify(payload) {
    const api = window.api || {};
    const candidates = [
      "sendNotify",
      "sendUserNotify",
      "sendNotifyUser",
      "sendNotifyToClient",
    ];

    let last = null;

    for (const fn of candidates) {
      if (typeof api[fn] !== "function") continue;
      try {
        const r = await api[fn](payload);
        last = r;
        if (r?.ok) return r;
      } catch (e) {
        last = {
          ok: false,
          error: "exception",
          detail: String(e?.message || e),
        };
      }
    }

    return last || { ok: false, error: "no_api" };
  }

  function initCompose() {
    if (typeof window.initNotifyUI !== "function") return;

    window.initNotifyUI({
      onSend: async ({ text }) => {
        const editor = els.editor;
        const btn = els.sendBtn;

        if (!selectedClientId) return showMsg("Chưa chọn client.", editor);
        if (!selectedClientOnline)
          return showMsg("Client đang OFFLINE.", editor);

        if (btn) btn.disabled = true;

        try {
          const r = await trySendNotify({
            clientId: selectedClientId,
            text,
            duration: DEFAULT_DURATION_SEC,
          });

          if (!r?.ok) {
            if (r?.error === "forbidden") {
              showMsg(
                "Gửi lỗi: forbidden\nTài khoản user chưa được cấp quyền gửi thông báo.\n(Nếu muốn user gửi được → phải sửa backend role/permission.)",
                editor
              );
            } else if (r?.error === "no_api") {
              showMsg(
                "Không tìm thấy API sendNotify ở preload (window.api).",
                editor
              );
            } else {
              showMsg("Gửi lỗi: " + (r?.error || "unknown"), editor);
            }
            return;
          }

          if (editor) editor.innerHTML = "";
          await refreshLogs();
          setTimeout(() => editor?.focus?.(), 0);
        } catch (e) {
          console.log("sendNotify error", e);
          showMsg("Gửi lỗi (exception). Mở console xem log.", editor);
        } finally {
          applySelectionUI();
        }
      },
    });

    applySelectionUI();
  }

  // =========================
  // Events
  // =========================
  function bindEvents() {
    els.btnRefreshClients?.addEventListener("click", refreshClients);

    els.searchClient?.addEventListener("input", () =>
      renderClients(clientsCache)
    );

    // ✅ SINGLE SELECT: click "Chọn" -> overwrite selectedClientId
    els.clientList?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.act !== "pick") return;

      const id = btn.dataset.id;
      const c = clientsCache.find((x) => x.clientId === id);
      if (!c) return;

      selectedClientId = id; // ✅ overwrite (chỉ 1 máy)
      selectedClientOnline = !!c.online;
      selectedClientLabel = clientLabel(c) || id;

      applySelectionUI();
      renderClients(clientsCache);
      refreshLogs();

      setTimeout(() => els.editor?.focus?.(), 0);
    });

    els.logoutBtn?.addEventListener("click", async () => {
      try {
        await window.api?.logout?.();
      } catch {}
    });
  }

  // =========================
  // Boot
  // =========================
  let booted = false;

  async function initAll() {
    if (booted) return;
    booted = true;

    cacheEls();
    bindModal();

    currentUsername = await loadMeName();
    safeText(els.meName, currentUsername || "...");

    bindEvents();

    await refreshClients();
    await refreshLogs();
    initCompose();

    setInterval(refreshClients, 10 * 60 * 1000);
    setInterval(refreshLogs, 30 * 1000);
  }

  function boot() {
    cacheEls();

    // đợi compose mount xong
    if (!els.editor || !els.sendBtn || !els.emojiBtn) {
      window.addEventListener("compose-ready", initAll, { once: true });
      return;
    }
    initAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
