// ui/js/admin_page.js
(() => {
  const $ = (id) => document.getElementById(id);

  function fmtTime(v) {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("vi-VN");
  }

  async function loadPartialInto(mountElOrSelector, relativePath) {
    const mountEl =
      typeof mountElOrSelector === "string"
        ? document.querySelector(mountElOrSelector)
        : mountElOrSelector;

    if (!mountEl)
      throw new Error("Mount element not found: " + mountElOrSelector);

    const url = new URL(relativePath, window.location.href);
    const res = await fetch(url);
    if (!res.ok) throw new Error("Load partial failed: " + res.status);
    mountEl.innerHTML = await res.text();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // =========================
  // Timers
  // =========================
  let clientsTimer = null;
  let logsTimer = null;
  let isEditingClientName = false;

  function stopAllTimers() {
    if (clientsTimer) {
      clearInterval(clientsTimer);
      clientsTimer = null;
    }
    if (logsTimer) {
      clearInterval(logsTimer);
      logsTimer = null;
    }
  }

  function startClientsAuto() {
    if (clientsTimer) clearInterval(clientsTimer);
    refreshClients();
    clientsTimer = setInterval(() => {
      if (isEditingClientName) return;
      refreshClients();
    }, 5000);
  }

  function startLogsAuto() {
    if (logsTimer) clearInterval(logsTimer);
    refreshLogs();
    logsTimer = setInterval(() => {
      refreshLogs({ keepPage: true });
    }, 30000);
  }

  document.addEventListener("focusin", (e) => {
    if (e.target?.classList?.contains("client-name-input"))
      isEditingClientName = true;
  });
  document.addEventListener("focusout", (e) => {
    if (e.target?.classList?.contains("client-name-input"))
      isEditingClientName = false;
  });

  // =========================
  // Tabs
  // =========================
  function setActiveTab(tabId) {
    document.querySelectorAll("#sideMenu .menu-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
  }

  window.show = function show(id) {
    stopAllTimers();

    document
      .querySelectorAll(".page")
      .forEach((p) => (p.style.display = "none"));

    const page = $(id);
    if (page) {
      page.style.display = page.classList.contains("page-scroll")
        ? "flex"
        : "block";
    }

    setActiveTab(id);

    if (id === "users") setTimeout(() => $("u_name")?.focus(), 0);

    if (id === "clients") {
      setTimeout(() => {
        $("clientSearchAdmin")?.focus();
        startClientsAuto();
      }, 0);
    }

    if (id === "notify") {
      setTimeout(() => {
        if (typeof window.__adminNotifySync === "function") {
          window.__adminNotifySync();
        }
        const editor = document.getElementById("msg");
        editor?.focus?.();
      }, 0);
    }

    if (id === "logs") {
      setTimeout(() => {
        $("logSearch")?.focus();
        startLogsAuto();
      }, 0);
    }
  };

  window.logout = async function logout() {
    if (!window.api?.logout)
      return showMsg("Lỗi IPC: window.api.logout không tồn tại.");
    await window.api.logout();
  };

  // =========================
  // Modal message
  // =========================
  const msgOverlay = $("msgOverlay");
  const msgText = $("msgText");
  const msgOk = $("msgOk");
  let focusAfterMsg = null;

  function showMsg(message, focusEl) {
    focusAfterMsg = focusEl || $("u_name");
    if (msgText) msgText.textContent = message;
    if (msgOverlay) msgOverlay.style.display = "flex";
    setTimeout(() => msgOk?.focus(), 0);
  }

  function closeMsg() {
    if (msgOverlay) msgOverlay.style.display = "none";
    const t = focusAfterMsg || $("u_name");
    focusAfterMsg = null;
    setTimeout(() => {
      t?.focus?.();
      t?.select?.();
    }, 0);
  }

  msgOk?.addEventListener("click", closeMsg);
  msgOverlay?.addEventListener("click", (e) => {
    if (e.target === msgOverlay) closeMsg();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (msgOverlay?.style.display === "flex") {
      e.preventDefault();
      closeMsg();
    } else if ($("editOverlay")?.style.display === "flex") {
      e.preventDefault();
      closeEdit();
    } else if ($("delOverlay")?.style.display === "flex") {
      e.preventDefault();
      closeDeleteUser();
    } else if ($("delClientOverlay")?.style.display === "flex") {
      e.preventDefault();
      closeDeleteClient();
    }
  });

  // =========================
  // USERS
  // =========================
  let currentMe = null;
  let meIsRoot = false;

  function setLoginLogsVisible(visible) {
    const sec = $("loginLogsSection");
    if (sec) sec.style.display = visible ? "block" : "none";
  }

  function setAdminAuditVisible(visible) {
    const sec = $("adminAuditSection");
    if (sec) sec.style.display = visible ? "block" : "none";
  }

  async function loadUsers() {
    const res = await window.api.getUsers();
    if (!res?.ok) {
      const msg =
        res?.error === "forbidden"
          ? "Chỉ admin mới xem được trang này."
          : "Bạn chưa đăng nhập hoặc phiên bị mất.";
      showMsg(msg, $("u_name"));
      return;
    }

    currentMe = res.me || null;
    meIsRoot = !!res.meIsRoot;

    document.body.classList.toggle("is-root", meIsRoot);

    // ROOT mới thấy 2 mục
    setLoginLogsVisible(meIsRoot);
    setAdminAuditVisible(meIsRoot);

    const users = res.users || [];
    const list = $("userList");
    if (!list) return;
    list.innerHTML = "";

    const usersCount = $("usersCount");
    if (usersCount) usersCount.textContent = `Users: ${users.length}`;

    for (const u of users) {
      const username = (u.username || "").trim();
      const role = (u.role || "user").trim();
      const isMe = currentMe && username === currentMe;
      const isBlocked = !!u.blocked;

      const isProtected = !!u.protected;
      const targetIsAdmin = role === "admin";

      let canEdit = true;
      let canDelete = false;
      let canBlock = true;

      canDelete = meIsRoot && !isProtected && !isMe;

      if (isProtected) {
        canDelete = false;
        canBlock = false;
        canEdit = !!isMe;
      } else {
        if (!meIsRoot && targetIsAdmin && !isMe) {
          canEdit = false;
        }
      }
      if (isMe) canBlock = false;
      if (isProtected) canBlock = false;
      if (!meIsRoot && targetIsAdmin) canBlock = false;

      const editBtn = canEdit
        ? `<button class="ghost" data-action="edit-user" data-username="${escapeHtml(
            username
          )}" data-role="${escapeHtml(role)}">Edit</button>`
        : `<button class="ghost" disabled style="opacity:.45;cursor:not-allowed;">Edit</button>`;

      const delBtn = canDelete
        ? `<button class="danger" data-action="del-user" data-username="${escapeHtml(
            username
          )}">Delete</button>`
        : `<button class="danger" disabled style="opacity:.45;cursor:not-allowed;">Delete</button>`;

      const blockBtn = canBlock
        ? isBlocked
          ? `<button class="ghost" data-action="toggle-block" data-username="${escapeHtml(
              username
            )}" data-blocked="1">Unblock</button>`
          : `<button class="danger" data-action="toggle-block" data-username="${escapeHtml(
              username
            )}" data-blocked="0">Block</button>`
        : `<button class="ghost" disabled style="opacity:.45;cursor:not-allowed;">${
            isBlocked ? "Unblock" : "Block"
          }</button>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(username)}${isMe ? " (me)" : ""}${
        isProtected ? " (ROOT)" : ""
      }${isBlocked ? ' <span class="badge off">Block</span>' : ""}</td>
         <td>${escapeHtml(role)}</td>
         <td>${fmtTime(u.createdAt)}</td>
         <td>${escapeHtml(u.createdBy || "")}</td>
         <td>${fmtTime(u.updatedAt)}</td>
         <td>${escapeHtml(u.updatedBy || "")}</td>
         <td><div class="actions">${editBtn}${delBtn}${blockBtn}</div></td>
        `;
      list.appendChild(tr);
    }

    // ROOT thì load audit + login logs luôn
    if (meIsRoot) {
      await refreshAdminAudit();
      await refreshLoginLogs();
    }
  }

  async function addUser() {
    const username = ($("u_name")?.value || "").trim();
    const password = ($("u_pass")?.value || "").trim();
    const role = $("u_role")?.value;

    if (!username) return showMsg("Thiếu Username", $("u_name"));
    if (!password) return showMsg("Thiếu Password", $("u_pass"));

    const addBtn = $("addBtn");
    if (addBtn) addBtn.disabled = true;

    try {
      const r = await window.api.createUser({ username, password, role });
      if (!r?.ok) {
        const msg =
          r?.error === "forbidden"
            ? "Chỉ admin mới được tạo tài khoản."
            : r?.error === "exists"
            ? "Username đã tồn tại."
            : r?.error === "missing_fields"
            ? "Thiếu thông tin."
            : r?.error === "only_root_can_create_admin"
            ? "Chỉ ROOT admin mới tạo được admin."
            : "Tạo user lỗi: " + (r?.error || "unknown");
        return showMsg(msg, $("u_name"));
      }

      $("u_name").value = "";
      $("u_pass").value = "";
      $("u_role").value = "user";

      showMsg("Đã tạo user", $("u_name"));
      await loadUsers();
    } catch (err) {
      console.error("createUser exception:", err);
      showMsg(
        "Lỗi khi tạo user: " + (err?.message || String(err)),
        $("u_name")
      );
    } finally {
      if (addBtn) addBtn.disabled = false;
    }
  }

  $("addBtn")?.addEventListener("click", addUser);
  $("u_pass")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addUser();
    }
  });

  $("btnRefreshUsersAll")?.addEventListener("click", async () => {
    await loadUsers();
  });

  // Edit modal
  const editOverlay = $("editOverlay");
  const eUser = $("e_username");
  const eRole = $("e_role");
  const ePass = $("e_pass");
  const editCancel = $("editCancel");
  const editSave = $("editSave");

  function openEdit(username, role) {
    if (eUser) eUser.value = username;
    if (eRole) eRole.value = role || "user";
    if (ePass) ePass.value = "";
    if (editOverlay) editOverlay.style.display = "flex";
    setTimeout(() => eRole?.focus(), 0);
  }

  function closeEdit() {
    if (editOverlay) editOverlay.style.display = "none";
    setTimeout(() => $("u_name")?.focus(), 0);
  }
  window.closeEdit = closeEdit;

  editCancel?.addEventListener("click", closeEdit);
  editOverlay?.addEventListener("click", (e) => {
    if (e.target === editOverlay) closeEdit();
  });

  // Delete user modal
  const delOverlay = $("delOverlay");
  const delText = $("delText");
  const delCancel = $("delCancel");
  const delOk = $("delOk");
  let delUsername = null;

  function openDeleteUser(username) {
    delUsername = username;
    if (delText)
      delText.textContent = `Bạn chắc chắn muốn xóa user: ${username} ?`;
    if (delOverlay) delOverlay.style.display = "flex";
    setTimeout(() => delOk?.focus(), 0);
  }

  function closeDeleteUser() {
    if (delOverlay) delOverlay.style.display = "none";
    delUsername = null;
    setTimeout(() => $("u_name")?.focus(), 0);
  }
  window.closeDeleteUser = closeDeleteUser;

  delCancel?.addEventListener("click", closeDeleteUser);
  delOverlay?.addEventListener("click", (e) => {
    if (e.target === delOverlay) closeDeleteUser();
  });

  $("userList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;

    const act = btn.dataset.action;

    if (act === "edit-user")
      return openEdit(btn.dataset.username, btn.dataset.role);
    if (act === "del-user") return openDeleteUser(btn.dataset.username);

    if (act === "toggle-block") {
      const username = btn.dataset.username;
      const curBlocked = btn.dataset.blocked === "1";
      const nextBlocked = !curBlocked;

      try {
        const r = await window.api.setUserBlocked({
          username,
          blocked: nextBlocked,
        });
        if (!r?.ok) {
          const msg =
            r?.error === "protected_user"
              ? "ROOT admin không thể bị block."
              : r?.error === "cannot_block_self"
              ? "Không được tự block chính mình."
              : r?.error === "cannot_block_admin"
              ? "Admin thường không được block admin khác."
              : "Block/Unblock lỗi: " + (r?.error || "unknown");
          return showMsg(msg);
        }

        showMsg(nextBlocked ? "Đã BLOCK user" : "Đã UNBLOCK user");
        await loadUsers();
      } catch (err) {
        console.error(err);
        showMsg("Lỗi Block/Unblock: " + (err?.message || String(err)));
      }
    }
  });

  editSave?.addEventListener("click", async () => {
    const username = (eUser?.value || "").trim();
    const role = eRole?.value;
    const password = ePass?.value || "";
    if (!username) return;

    editSave.disabled = true;
    try {
      const r = await window.api.updateUser({ username, role, password });
      if (!r?.ok) {
        const msg =
          r.error === "cannot_change_own_role"
            ? "Không được tự đổi role của chính mình."
            : r.error === "forbidden"
            ? "Chỉ admin mới được sửa."
            : r.error === "not_found"
            ? "User không tồn tại."
            : r.error === "nothing_to_update"
            ? "Không có gì để cập nhật."
            : r.error === "only_root_can_promote_admin"
            ? "Chỉ ROOT admin mới được nâng user lên admin."
            : r.error === "cannot_edit_admin"
            ? "Admin thường không được sửa admin khác."
            : r.error === "protected_user"
            ? "ROOT admin không thể bị chỉnh role."
            : "Update lỗi: " + (r.error || "unknown");

        closeEdit();
        setTimeout(() => showMsg(msg, $("u_name")), 0);
        return;
      }

      closeEdit();
      showMsg("Đã cập nhật user", $("u_name"));
      await loadUsers();
    } catch (err) {
      console.error(err);
      showMsg(
        "Lỗi khi cập nhật user: " + (err?.message || String(err)),
        $("u_name")
      );
    } finally {
      editSave.disabled = false;
    }
  });

  delOk?.addEventListener("click", async () => {
    const username = delUsername;
    if (!username) return;

    delOk.disabled = true;
    try {
      const r = await window.api.deleteUser(username);
      if (!r?.ok) {
        const msg =
          r.error === "only_root_can_delete"
            ? "Chỉ ROOT admin mới được xóa tài khoản."
            : r.error === "cannot_delete_self"
            ? "Không được xóa chính mình."
            : r.error === "protected_user"
            ? "ROOT admin không thể bị xóa."
            : "Xóa lỗi: " + (r.error || "unknown");

        closeDeleteUser();
        showMsg(msg, $("u_name"));
        return;
      }
      closeDeleteUser();
      showMsg("Đã xóa user", $("u_name"));
      await loadUsers();
    } catch (err) {
      console.error(err);
      closeDeleteUser();
      showMsg(
        "Lỗi khi xóa user: " + (err?.message || String(err)),
        $("u_name")
      );
    } finally {
      delOk.disabled = false;
    }
  });

  // =========================
  // ADMIN AUDIT LOGS (ROOT ONLY)
  // =========================
  let adminAuditCache = [];

  function auditActionLabel(a) {
    switch (String(a || "")) {
      case "create_user":
        return "Create user";
      case "delete_user":
        return "Delete user";
      case "block_user":
        return "Block";
      case "unblock_user":
        return "Unblock";
      case "change_password":
        return "Change pass";
      case "change_role":
        return "Change role";
      case "login_blocked":
        return "Login blocked";
      case "auto_block_failed_login":
        return "Auto block (Fail)";
      default:
        return String(a || "");
    }
  }

  // ✅ render FULL để scroll (không slice)
  function renderAdminAudit(items) {
    const tbody = $("adminAuditList");
    if (!tbody) return;

    const countEl = $("adminAuditCount");
    if (countEl) countEl.textContent = `Tổng: ${(items || []).length}`;

    tbody.innerHTML = "";
    (items || []).forEach((l, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(fmtTime(l.createdAt))}</td>
        <td>${escapeHtml(l.by || "")}</td>
        <td>${escapeHtml(auditActionLabel(l.action))}</td>
        <td>${escapeHtml(l.target || "")}</td>
        <td style="white-space:pre-wrap">${escapeHtml(l.note || "")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function refreshAdminAudit() {
    if (!meIsRoot) return;

    try {
      const r = await window.api.getAdminAuditLogs({ limit: 2000 });
      if (!r?.ok) return;
      adminAuditCache = r.logs || [];
      renderAdminAudit(adminAuditCache);
    } catch (err) {
      console.error(err);
    }
  }

  // =========================
  // LOGIN LOGS (ROOT ONLY)
  // =========================
  let loginLogsCache = [];

  // ✅ render FULL để scroll
  function renderLoginLogs(items) {
    const tbody = $("loginLogList");
    if (!tbody) return;

    const q = ($("loginLogSearch")?.value || "").trim().toLowerCase();
    const filtered = !q
      ? items || []
      : (items || []).filter((l) => {
          const s = `${l.username || ""} ${l.role || ""} ${
            l.deviceName || ""
          } ${l.deviceIp || ""} ${
            l.platformLabel || l.platform || ""
          }`.toLowerCase();
          return s.includes(q);
        });

    const countEl = $("loginLogsCount");
    if (countEl) countEl.textContent = `Tổng: ${filtered.length}`;

    tbody.innerHTML = "";
    filtered.forEach((l, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(fmtTime(l.createdAt))}</td>
        <td>${escapeHtml(l.username || "")}</td>
        <td>${escapeHtml(l.role || "")}</td>
        <td>${escapeHtml(l.deviceName || "")}</td>
        <td>${escapeHtml(l.deviceIp || "")}</td>
        <td>${escapeHtml(l.platformLabel || l.platform || "")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function refreshLoginLogs() {
    if (!meIsRoot) return;
    try {
      const q = ($("loginLogSearch")?.value || "").trim();
      const r = await window.api.getLoginLogs({ q, limit: 2000 });
      if (!r?.ok) return;
      loginLogsCache = r.logs || [];
      renderLoginLogs(loginLogsCache);
    } catch (err) {
      console.error(err);
    }
  }

  $("loginLogSearch")?.addEventListener("input", () =>
    renderLoginLogs(loginLogsCache)
  );

  // =========================
  // CLIENTS
  // =========================
  let clientsCache = [];

  function clientDisplayName(c) {
    return (c?.name || c?.reportedName || c?.clientId || "").trim();
  }

  function renderClientsAdmin(items) {
    const tbody = $("clientListAdmin");
    if (!tbody) return;

    const q = ($("clientSearchAdmin")?.value || "").trim().toLowerCase();
    const filtered = !q
      ? items
      : items.filter((c) => {
          const s = `${c.clientId || ""} ${c.name || ""} ${
            c.reportedName || ""
          } ${c.ip || ""}`.toLowerCase();
          return s.includes(q);
        });

    const countEl = $("clientsCount");
    if (countEl) countEl.textContent = `Clients: ${filtered.length}`;

    tbody.innerHTML = "";

    filtered.forEach((c, idx) => {
      const tr = document.createElement("tr");
      const st = c.online
        ? `<span class="badge on">Online</span>`
        : `<span class="badge off">Offline</span>`;
      const name = clientDisplayName(c);
      const ip = c.ip || "";

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>
          <div class="client-name-wrap">
            <input data-clientid="${escapeHtml(
              c.clientId
            )}" class="client-name-input" spellcheck="false"
              value="${escapeHtml(name)}" />

            <span class="muted client-meta">
              ID: ${escapeHtml(c.clientId)} | Máy báo: ${escapeHtml(
        c.reportedName || ""
      )}
            </span>
          </div>
        </td>

        <td>${st}</td>
        <td>${escapeHtml(ip)}</td>
        <td>
          <div class="actions">
            <button class="ghost" data-action="save-client" data-clientid="${escapeHtml(
              c.clientId
            )}">Save</button>
            <button class="danger" data-action="del-client" data-clientid="${escapeHtml(
              c.clientId
            )}">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function fillClientSelect(items) {
    const sel = $("clientSelect");
    if (!sel) return;

    const current = sel.value;
    sel.innerHTML = `<option value="">-- Chọn client --</option>`;

    items.forEach((c) => {
      const label = `${clientDisplayName(c)}${c.ip ? " (" + c.ip + ")" : ""}${
        c.online ? "" : " [OFF]"
      }`;
      const opt = document.createElement("option");
      opt.value = c.clientId;
      opt.textContent = label;
      sel.appendChild(opt);
    });

    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  }

  async function refreshClients() {
    try {
      const r = await window.api.getClients();
      if (!r?.ok) return;

      clientsCache = r.clients || [];
      renderClientsAdmin(clientsCache);
      fillClientSelect(clientsCache);

      if (typeof window.__adminNotifySync === "function") {
        window.__adminNotifySync();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function saveClientName(clientId) {
    const input = document.querySelector(
      `.client-name-input[data-clientid="${clientId}"]`
    );
    const name = (input?.value || "").trim();
    if (!name)
      return showMsg(
        "Tên không được để trống",
        input || $("clientSearchAdmin")
      );

    const r = await window.api.updateClientName({ clientId, name });
    if (!r?.ok) return showMsg("Lưu lỗi: " + (r?.error || "unknown"));

    isEditingClientName = false;
    showMsg("Đã lưu tên client", $("clientSearchAdmin"));
    refreshClients();
  }

  // delete client modal
  const delClientOverlay = $("delClientOverlay");
  const delClientText = $("delClientText");
  const delClientCancel = $("delClientCancel");
  const delClientOk = $("delClientOk");
  let delClientId = null;

  function openDeleteClient(clientId, label) {
    delClientId = clientId;
    if (delClientText)
      delClientText.textContent = `Xóa client này khỏi danh sách?\n${label}\nID: ${clientId}`;
    if (delClientOverlay) delClientOverlay.style.display = "flex";
    setTimeout(() => delClientOk?.focus(), 0);
  }

  function closeDeleteClient() {
    if (delClientOverlay) delClientOverlay.style.display = "none";
    delClientId = null;
    setTimeout(() => $("clientSearchAdmin")?.focus(), 0);
  }
  window.closeDeleteClient = closeDeleteClient;

  delClientCancel?.addEventListener("click", closeDeleteClient);
  delClientOverlay?.addEventListener("click", (e) => {
    if (e.target === delClientOverlay) closeDeleteClient();
  });

  function askDeleteClient(clientId) {
    const c = clientsCache.find((x) => x.clientId === clientId);
    const label = c
      ? `${clientDisplayName(c)}${c.ip ? " (" + c.ip + ")" : ""}`
      : clientId;
    openDeleteClient(clientId, label);
  }

  delClientOk?.addEventListener("click", async () => {
    const clientId = delClientId;
    if (!clientId) return;

    delClientOk.disabled = true;
    try {
      const r = await window.api.deleteClient(clientId);
      if (!r?.ok) {
        closeDeleteClient();
        showMsg("Xóa lỗi: " + (r?.error || "unknown"), $("clientSearchAdmin"));
        return;
      }
      closeDeleteClient();
      showMsg("Đã xóa client", $("clientSearchAdmin"));
      refreshClients();
    } catch (err) {
      console.error(err);
      closeDeleteClient();
      showMsg(
        "Lỗi khi xóa client: " + (err?.message || String(err)),
        $("clientSearchAdmin")
      );
    } finally {
      delClientOk.disabled = false;
    }
  });

  $("clientListAdmin")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.action;
    const clientId = btn.dataset.clientid;
    if (act === "save-client") saveClientName(clientId);
    if (act === "del-client") askDeleteClient(clientId);
  });

  $("clientListAdmin")?.addEventListener("keydown", (e) => {
    const input = e.target.closest(".client-name-input");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      saveClientName(input.dataset.clientid);
    }
  });

  $("clientSearchAdmin")?.addEventListener("input", () =>
    renderClientsAdmin(clientsCache)
  );
  $("btnRefreshClients")?.addEventListener("click", refreshClients);

  // =========================
  // NOTIFY (admin)
  // =========================
  function setComposeEnabled(enabled) {
    const editor = document.getElementById("msg");
    const sendBtn = document.getElementById("sendBtn");

    if (editor) {
      editor.classList.toggle("disabled", !enabled);
      editor.setAttribute("contenteditable", enabled ? "true" : "false");
      if (!enabled) editor.innerHTML = "";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (sendBtn && !enabled) sendBtn.disabled = true;
  }

  function syncAdminNotifySelected() {
    const sel = document.getElementById("clientSelect");
    if (!sel) return;

    const clientId = (sel.value || "").trim();
    const c = clientsCache.find((x) => x.clientId === clientId);

    const nameEl = document.getElementById("selectedClientName");
    const stEl = document.getElementById("selectedClientStatus");

    if (nameEl) nameEl.textContent = c ? clientDisplayName(c) : "Chưa chọn";

    if (stEl) {
      const online = !!c?.online;
      stEl.textContent = online ? "ONLINE" : "OFFLINE";
      stEl.classList.toggle("on", online);
      stEl.classList.toggle("off", !online);
    }

    setComposeEnabled(!!clientId);

    if (clientId) {
      const editor = document.getElementById("msg");
      setTimeout(() => editor?.focus?.(), 0);
    }
  }

  window.__adminNotifySync = syncAdminNotifySelected;

  async function initAdminNotifyUI() {
    const mount = $("composeMountAdmin");
    if (!mount) return;

    await loadPartialInto(mount, "./partials/notify_compose.html");

    const slot = document.getElementById("notifyMetaSlot");
    if (slot) {
      slot.innerHTML = `
        <div class="meta row-flex" style="gap: 10px">
          <select id="clientSelect" class="w260">
            <option value="">-- Chọn client --</option>
          </select>
          <input id="duration" class="w160" type="number" value="30" min="1" max="600" />
        </div>
      `;
    }

    initNotifyUI({
      maxLen: 100,
      onSend: async ({ text }) => {
        const clientId = ($("clientSelect")?.value || "").trim();
        const duration = Number($("duration")?.value || 30);
        if (!clientId) return showMsg("Chưa chọn client", $("clientSelect"));

        const r = await window.api.sendNotify({ clientId, text, duration });
        if (!r?.ok)
          return showMsg(
            "Gửi lỗi: " + (r?.error || "unknown"),
            $("clientSelect")
          );

        showMsg("Đã gửi", $("msg"));
      },
    });

    const sel = document.getElementById("clientSelect");
    sel?.addEventListener("change", syncAdminNotifySelected);

    syncAdminNotifySelected();
  }

  // =========================
  // LOGS
  // =========================
  let logsCache = [];
  let logsPage = 1;
  const LOGS_PAGE_SIZE = 50;
  let logsSearchTimer = null;

  function getDateMs(dateStr, isEnd) {
    if (!dateStr) return null;
    const d = new Date(dateStr + (isEnd ? "T23:59:59.999" : "T00:00:00.000"));
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function getLogsFilterPayload() {
    const q = ($("logSearch")?.value || "").trim();
    const by = ($("logByFilter")?.value || "").trim();
    const client = ($("logClientFilter")?.value || "").trim();
    const fromMs = getDateMs($("logFrom")?.value || "", false);
    const toMs = getDateMs($("logTo")?.value || "", true);

    return {
      q,
      by: by || "",
      client: client || "",
      fromMs: fromMs ?? null,
      toMs: toMs ?? null,
      limit: 5000,
    };
  }

  function fillLogsFilters(items) {
    const bySel = $("logByFilter");
    if (bySel) {
      const cur = bySel.value;
      const set = new Set();
      (items || []).forEach((l) => l?.by && set.add(String(l.by)));
      const arr = [...set].sort((a, b) => a.localeCompare(b));
      bySel.innerHTML =
        `<option value="">-- Người gửi --</option>` +
        arr
          .map(
            (x) => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`
          )
          .join("");
      if ([...bySel.options].some((o) => o.value === cur)) bySel.value = cur;
    }

    const cSel = $("logClientFilter");
    if (cSel) {
      const cur = cSel.value;
      const map = new Map();
      (items || []).forEach((l) => {
        const id = (l?.clientId || "").trim();
        if (!id) return;
        const name = (l?.clientName || "").trim();
        const ip = (l?.clientIp || "").trim();
        const label = `${name || id}${ip ? " (" + ip + ")" : ""}`;
        if (!map.has(id)) map.set(id, label);
      });
      const arr = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
      cSel.innerHTML =
        `<option value="">-- Client --</option>` +
        arr
          .map(
            ([id, label]) =>
              `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
          )
          .join("");
      if ([...cSel.options].some((o) => o.value === cur)) cSel.value = cur;
    }
  }

  function renderLogs(items) {
    const tbody = $("logList");
    if (!tbody) return;

    const total = (items || []).length;
    const totalPages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE));
    logsPage = Math.min(Math.max(1, logsPage), totalPages);

    const start = (logsPage - 1) * LOGS_PAGE_SIZE;
    const pageItems = (items || []).slice(start, start + LOGS_PAGE_SIZE);

    const countEl = $("logsCount");
    if (countEl) countEl.textContent = `Tổng: ${total}`;

    const pageInfo = $("logsPageInfo");
    if (pageInfo)
      pageInfo.textContent = `Trang ${logsPage}/${totalPages} • ${LOGS_PAGE_SIZE}/trang`;

    const prevBtn = $("btnPrevLogs");
    const nextBtn = $("btnNextLogs");
    if (prevBtn) prevBtn.disabled = logsPage <= 1;
    if (nextBtn) nextBtn.disabled = logsPage >= totalPages;

    tbody.innerHTML = "";

    pageItems.forEach((l, idx) => {
      const t = l.createdAt
        ? new Date(l.createdAt).toLocaleString("vi-VN")
        : "";
      const clientLabel = `${l.clientName || ""}`.trim() || l.clientId || "";
      const status = (l.status || "").toLowerCase();

      const badge =
        status === "sent"
          ? `<span class="badge on">sent</span>`
          : `<span class="badge off">${escapeHtml(status || "offline")}</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${start + idx + 1}</td>
        <td>${escapeHtml(t)}</td>
        <td>${escapeHtml(l.by || "")}</td>
        <td>
        <div class="client-inline">
          <span class="client-title">${escapeHtml(clientLabel)}</span>
          <span class="muted client-id">ID: ${escapeHtml(
            l.clientId || ""
          )}</span>
        </div>
        </td>
        <td>${escapeHtml(l.clientIp || "")}</td>
        <td>${escapeHtml(String(l.duration ?? ""))}s</td>
        <td>${badge}</td>
        <td style="white-space:pre-wrap">${escapeHtml(l.text || "")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function refreshLogs({ keepPage = false } = {}) {
    try {
      const payload = getLogsFilterPayload();
      const r = await window.api.getLogs(payload);
      if (!r?.ok) return;

      logsCache = r.logs || [];
      if (!keepPage) logsPage = 1;

      fillLogsFilters(logsCache);
      renderLogs(logsCache);
    } catch (err) {
      console.error(err);
    }
  }

  $("logSearch")?.addEventListener("input", () => {
    if (logsSearchTimer) clearTimeout(logsSearchTimer);
    logsSearchTimer = setTimeout(() => {
      logsPage = 1;
      refreshLogs({ keepPage: false });
    }, 250);
  });

  $("logByFilter")?.addEventListener("change", () => {
    logsPage = 1;
    refreshLogs({ keepPage: false });
  });
  $("logClientFilter")?.addEventListener("change", () => {
    logsPage = 1;
    refreshLogs({ keepPage: false });
  });
  $("logFrom")?.addEventListener("change", () => {
    logsPage = 1;
    refreshLogs({ keepPage: false });
  });
  $("logTo")?.addEventListener("change", () => {
    logsPage = 1;
    refreshLogs({ keepPage: false });
  });

  $("btnRefreshLogs")?.addEventListener("click", () =>
    refreshLogs({ keepPage: false })
  );

  $("btnPrevLogs")?.addEventListener("click", () => {
    logsPage = Math.max(1, logsPage - 1);
    renderLogs(logsCache);
  });
  $("btnNextLogs")?.addEventListener("click", () => {
    logsPage = logsPage + 1;
    renderLogs(logsCache);
  });

  $("btnExportLogs")?.addEventListener("click", async () => {
    const payload = getLogsFilterPayload();
    const r = await window.api.exportLogsExcel({ ...payload, maxRows: 5000 });
    if (!r?.ok) {
      if (r?.error !== "canceled")
        showMsg("Export lỗi: " + (r?.error || "unknown"));
      return;
    }
    showMsg("Đã export:\n" + r.filePath);
  });

  // =========================
  // Version (sidebar)
  // =========================
  async function setAppVersionUI() {
    const el = $("appVersion");
    if (!el) return;

    // ưu tiên API nếu có
    try {
      if (window.api?.getAppVersion) {
        const v = await window.api.getAppVersion();
        if (v) {
          el.textContent = `v${String(v).replace(/^v/i, "")}`;
          return;
        }
      }
    } catch {}

    // fallback: nếu preload set sẵn
    if (window.__APP_VERSION__) {
      el.textContent = `v${String(window.__APP_VERSION__).replace(/^v/i, "")}`;
      return;
    }

    // fallback cuối: giữ v0.0.0
  }

  // =========================
  // Init
  // =========================
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (!window.api) {
        showMsg(
          "Lỗi preload: window.api không tồn tại.\n" +
            "Kiểm tra mainWindow webPreferences phải có sandbox:false + đúng preload path."
        );
        return;
      }

      await setAppVersionUI();

      await loadUsers();
      await initAdminNotifyUI();
      await refreshClients();
      window.show("users");
    } catch (err) {
      console.error(err);
      showMsg("Init lỗi: " + (err?.message || String(err)));
    }
  });
})();
