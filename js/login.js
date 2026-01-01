const form = document.getElementById("loginForm");
const errorBox = document.getElementById("error");

function setErr(msg) {
  errorBox.innerText = msg || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!username || !password) {
    setErr("Vui lòng nhập đầy đủ thông tin");
    return;
  }

  setErr("");

  try {
    const result = await window.auth.login({ username, password });

    // ✅ Nếu preload trả boolean
    if (result === true) return; // success
    if (result === false || result == null) {
      setErr("Sai tài khoản hoặc mật khẩu");
      return;
    }

    // ✅ Object format: {ok, error}
    if (typeof result === "object") {
      if (result.ok) return;

      switch (result.error) {
        case "blocked":
          setErr("User bị block, liên hệ admin.");
          break;

        case "invalid_credentials":
          setErr("Sai tài khoản hoặc mật khẩu");
          break;

        case "missing_fields":
          setErr("Vui lòng nhập đầy đủ thông tin");
          break;

        case "server_error":
          setErr("Lỗi hệ thống, thử lại sau");
          break;

        default:
          setErr("Đăng nhập thất bại: " + (result.error || "unknown"));
          break;
      }
      return;
    }

    // ✅ format lạ
    setErr("Sai tài khoản hoặc mật khẩu");
  } catch (err) {
    setErr("Không kết nối được server");
  }
});
