const WebSocket = require("ws");

/**
 * startSocketServer(db, port)
 * - Realtime clients in RAM (Map)
 * - Upsert MongoDB collection: clients (throttle)
 * - Ping/pong: online/offline stable, avoid false terminate
 * - send(clientId, payload): notify
 */

function startSocketServer(db, port = 3000) {
  // ===== Tuning =====
  const PING_INTERVAL_MS = 15000; // ping mỗi 15s
  const MAX_MISSED_PONGS = 2; // miss 2 lần mới terminate (≈ 30s)
  const DB_SEEN_THROTTLE_MS = 30000; // ghi lastSeen DB tối đa 30s/lần/client
  const DEBUG_RAW = false; // bật true nếu cần debug

  // clientId => { ws, reportedName, ip, lastSeenMs, missedPongs, dbLastSeenMs, closing }
  const clients = new Map();

  // 🔥🔥🔥 FIX QUAN TRỌNG NHẤT – BIND RA TOÀN MẠNG
  const wss = new WebSocket.Server({
    host: "0.0.0.0",
    port
  });

  console.log("🟢 WebSocket running on 0.0.0.0:" + port);

  async function upsertClient(clientId, patch) {
    try {
      if (!db || !clientId) return;
      const reportedName = patch?.reportedName;

      await db.collection("clients").updateOne(
        { clientId },
        {
          $set: {
            clientId,
            ...(patch || {}),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
            name: reportedName || "Client",
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.log("❌ UPSERT FAIL:", e?.message || e);
    }
  }

  function now() {
    return Date.now();
  }

  async function markOnline(clientId, { ws, reportedName, ip }) {
    const entry = clients.get(clientId);

    // Nếu clientId đã tồn tại nhưng ws khác -> đá ws cũ
    if (entry && entry.ws && entry.ws !== ws) {
      try { entry.ws.terminate(); } catch {}
    }

    clients.set(clientId, {
      ws,
      reportedName: reportedName || entry?.reportedName || "Client",
      ip: ip || entry?.ip || "",
      lastSeenMs: now(),
      missedPongs: 0,
      dbLastSeenMs: entry?.dbLastSeenMs || 0,
      closing: false,
    });

    // chỉ ghi DB khi hello (online true)
    await upsertClient(clientId, {
      reportedName: reportedName || "Client",
      ip: ip || "",
      online: true,
      lastSeen: new Date(),
    });
  }

  async function markOffline(clientId) {
    const entry = clients.get(clientId);
    if (!entry) return;

    // tránh close+error gọi 2 lần
    if (entry.closing) return;
    entry.closing = true;

    clients.delete(clientId);
    await upsertClient(clientId, { online: false, lastSeen: new Date() });
  }

  function touchSeen(clientId) {
    const entry = clients.get(clientId);
    if (!entry) return;

    entry.lastSeenMs = now();
    entry.missedPongs = 0;
  }

  async function throttleDbSeen(clientId) {
    const entry = clients.get(clientId);
    if (!entry) return;

    const t = now();
    if (t - (entry.dbLastSeenMs || 0) < DB_SEEN_THROTTLE_MS) return;

    entry.dbLastSeenMs = t;
    // chỉ update lastSeen + online (nhẹ), không update name mỗi lần
    await upsertClient(clientId, { online: true, lastSeen: new Date() });
  }

  wss.on("connection", (ws, req) => {
    ws.isAlive = true;
    let clientId = null;

    ws.on("pong", () => {
      ws.isAlive = true;
      if (clientId) {
        touchSeen(clientId);
        throttleDbSeen(clientId).catch(() => {});
      }
    });

    ws.on("message", async (raw) => {
      if (DEBUG_RAW) console.log("RAW:", raw.toString());

      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // HELLO: đăng ký client
      if (data.type === "hello") {
        clientId = String(data.clientId || "").trim();
        if (!clientId) return;

        const reportedName = String(data.name || "Client");
        const ip = String(data.ip || "");

        await markOnline(clientId, { ws, reportedName, ip });
        console.log("✅ HELLO:", clientId, reportedName, ip);
        return;
      }

      // HEARTBEAT JSON (optional)
      if (data.type === "heartbeat" && clientId) {
        touchSeen(clientId);
        throttleDbSeen(clientId).catch(() => {});
        return;
      }

      if (data.type === "log") {
        console.log("📩", data.text);
      }
    });

    ws.on("close", () => {
      if (clientId) markOffline(clientId).catch(() => {});
    });

    ws.on("error", () => {
      if (clientId) markOffline(clientId).catch(() => {});
    });
  });

  // ===== Server ping/pong =====
  const pingInterval = setInterval(() => {
    for (const [id, entry] of clients.entries()) {
      const ws = entry.ws;

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        markOffline(id).catch(() => {});
        continue;
      }

      if (ws.isAlive === false) {
        entry.missedPongs = (entry.missedPongs || 0) + 1;

        if (entry.missedPongs >= MAX_MISSED_PONGS) {
          try { ws.terminate(); } catch {}
          markOffline(id).catch(() => {});
          continue;
        }
      }

      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, PING_INTERVAL_MS);

  wss.on("close", () => clearInterval(pingInterval));

  return {
    getClients: () => {
      return [...clients.entries()].map(([clientId, c]) => ({
        clientId,
        reportedName: c.reportedName,
        ip: c.ip,
        online: true,
        lastSeen: c.lastSeenMs,
      }));
    },

    send: (clientId, payload) => {
      const id = String(clientId || "").trim();
      const c = clients.get(id);
      if (!c || !c.ws || c.ws.readyState !== WebSocket.OPEN) return false;

      const p = payload || {};
      const msg = {
        type: "notify",
        title: p.title || "Thông báo",
        text: p.text || "",
        duration: Number(p.duration || 30),
      };

      try {
        c.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    },
  };
}

module.exports = { startSocketServer };
