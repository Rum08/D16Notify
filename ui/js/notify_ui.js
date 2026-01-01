// ui/js/notify_ui.js
(function () {
  function initNotifyUI(opts) {
    const {
      editorId = "msg",
      sendBtnId = "sendBtn",
      emojiBtnId = "emojiBtn",
      emojiPanelId = "emojiPanel",
      counterId = "charCounter",
      maxLen = 100,
      onSend = null, // async ({ html, text }) => {}
    } = opts || {};

    const editor = document.getElementById(editorId);
    const sendBtn = document.getElementById(sendBtnId);
    const emojiBtn = document.getElementById(emojiBtnId);
    const emojiPanel = document.getElementById(emojiPanelId);

    if (!editor) {
      console.warn(`[notify_ui] editor #${editorId} not found`);
      return { doSend: async () => {} };
    }

    // =========================
    // Counter (nếu không có thì tự tạo)
    // =========================
    let counterEl = document.getElementById(counterId);

    function ensureCounter() {
      if (counterEl) return counterEl;

      const root = editor.closest(".compose-root") || document;
      const sendRow =
        root.querySelector(".send-row") || document.querySelector(".send-row");
      if (!sendRow) return null;

      counterEl = document.createElement("div");
      counterEl.id = counterId;
      counterEl.className = "muted";
      counterEl.style.cssText =
        "margin-left:14px; user-select:none; white-space:nowrap;";

      // đặt sau nút gửi nếu có
      if (sendBtn) sendBtn.insertAdjacentElement("afterend", counterEl);
      else sendRow.appendChild(counterEl);

      return counterEl;
    }

    // =========================
    // Helpers
    // =========================
    function isEditorDisabled() {
      // ✅ FIX: chỉ tin vào contenteditable / disabled thật sự,
      // KHÔNG dùng class 'disabled' để tránh admin bị disable khi gõ.
      if (editor.hasAttribute("contenteditable")) {
        return editor.getAttribute("contenteditable") !== "true";
      }
      // fallback textarea/input
      if ("disabled" in editor) return !!editor.disabled;
      return false;
    }

    function getPlainTextRaw() {
      return (editor.innerText || "").replace(/\r/g, "");
    }

    function getPlainTextTrim() {
      return getPlainTextRaw().trim();
    }

    function setCaretToEnd() {
      try {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
    }

    function setCounter(n) {
      const c = ensureCounter();
      if (!c) return;
      c.textContent = `${n}/${maxLen}`;
    }

    function clampToMaxLen() {
      const t = getPlainTextRaw();
      if (t.length <= maxLen) {
        setCounter(t.length);
        return;
      }
      editor.innerText = t.slice(0, maxLen);
      setCaretToEnd();
      setCounter(maxLen);
    }

    function updateSendState() {
      if (!sendBtn) return;

      if (isEditorDisabled()) {
        sendBtn.disabled = true;
        return;
      }
      sendBtn.disabled = getPlainTextTrim().length === 0;
    }

    function syncUI() {
      const len = getPlainTextRaw().length;
      setCounter(Math.min(len, maxLen));
      updateSendState();
    }

    // =========================
    // Toolbar bold/italic/underline
    // =========================
    document.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isEditorDisabled()) return;
        const cmd = btn.getAttribute("data-cmd");
        editor.focus();
        document.execCommand(cmd, false, null);
        syncUI();
      });
    });

    // =========================
    // Emoji
    // =========================
    if (emojiBtn && emojiPanel) {
      emojiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        emojiPanel.classList.toggle("hidden");
      });

      emojiPanel.querySelectorAll("span").forEach((sp) => {
        sp.addEventListener("click", () => {
          if (isEditorDisabled()) return;

          const cur = getPlainTextRaw();
          if (cur.length >= maxLen) {
            syncUI();
            emojiPanel.classList.add("hidden");
            return;
          }

          editor.focus();
          document.execCommand("insertText", false, sp.textContent);
          clampToMaxLen();
          updateSendState();
          emojiPanel.classList.add("hidden");
        });
      });

      document.addEventListener("click", () =>
        emojiPanel.classList.add("hidden")
      );
    }

    // =========================
    // Keydown: chặn vượt maxLen
    // =========================
    editor.addEventListener("keydown", (e) => {
      // Ctrl+Enter gửi
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        doSend();
        return;
      }

      if (isEditorDisabled()) return;

      const controlKeys = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Tab",
        "Escape",
        "Enter",
      ];
      if (controlKeys.includes(e.key)) return;

      if (e.ctrlKey || e.metaKey) return;

      const len = getPlainTextRaw().length;
      if (len >= maxLen) {
        e.preventDefault();
        syncUI();
      }
    });

    // =========================
    // Paste: text only + limit
    // =========================
    editor.addEventListener("paste", (e) => {
      if (isEditorDisabled()) return;

      e.preventDefault();
      const paste =
        (e.clipboardData || window.clipboardData)?.getData("text") || "";

      const current = getPlainTextRaw();
      const remain = maxLen - current.length;
      if (remain <= 0) {
        syncUI();
        return;
      }

      const chunk = paste.slice(0, remain);
      editor.focus();
      document.execCommand("insertText", false, chunk);

      clampToMaxLen();
      updateSendState();
    });

    // =========================
    // Input
    // =========================
    editor.addEventListener("input", () => {
      if (!isEditorDisabled()) clampToMaxLen();
      syncUI();
    });

    // =========================
    // Send
    // =========================
    async function doSend() {
      if (isEditorDisabled()) return;

      const text = getPlainTextTrim();
      if (!text) return;

      const html = (editor.innerHTML || "").trim();

      if (typeof onSend === "function") {
        await onSend({ html, text });
      }

      editor.innerHTML = "";
      editor.focus();
      syncUI();
    }

    if (sendBtn) sendBtn.addEventListener("click", doSend);

    // init
    ensureCounter();
    syncUI();

    return { doSend };
  }

  window.initNotifyUI = initNotifyUI;
})();
