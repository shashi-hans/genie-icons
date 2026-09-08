// The one way any page talks to this site's API, plus the toast it uses to say
// what happened.
//
// Same-origin with credentials, because the session and guest cookies are the
// point: the server decides who you are, and a role decided in the browser is a
// role the browser can change.

/**
 * Call the API and return its JSON. Throws an Error carrying the server's own
 * message, so callers can show it verbatim rather than inventing one.
 */
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Count one copy or download, for the usage tally on the admin page.
 *
 * Fire-and-forget by design: it must never delay the export or turn a database
 * hiccup into a failed copy, so nothing is awaited and every error is swallowed.
 * `sendBeacon` is used where it exists because it survives the page being closed
 * in the same gesture, which a download can cause.
 *
 * `name` is the icon; pass "" where there is no icon of ours, which is the
 * resizer working on a file the user supplied. Nothing identifying is sent —
 * the guest cookie rides along as it does on every same-origin request, and the
 * server does not read it here.
 *
 * `count` is for one gesture that exports several files at once — the resizer's
 * "Download all" — so the tally matches what the individual buttons would have
 * added without sending a beacon per file.
 *
 * @param {string} name
 * @param {"copy"|"download"} action
 * @param {number} [count]
 */
export function recordUse(name, action, count = 1) {
  const body = JSON.stringify({ name: name || "", action, count });
  try {
    if (navigator.sendBeacon) {
      // A typed Blob, so the request arrives as JSON rather than as the
      // text/plain sendBeacon sends for a bare string.
      navigator.sendBeacon("/api/uses", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/uses", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* counting is not worth an error in front of the user */
  }
}

let toastTimer = null;

/** Brief confirmation at the bottom of the page. Creates its own node if needed. */
export function showToast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

/** Hand the browser a file to save. */
export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next turn of the event loop: doing it synchronously can
  // cancel the download in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
