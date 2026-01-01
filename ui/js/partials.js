// ui/js/partials.js
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

  // ✅ báo cho user_page.js biết compose đã mount xong
  window.dispatchEvent(new Event("compose-ready"));
}
