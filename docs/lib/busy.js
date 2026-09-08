// The busy state for a button that is waiting on something.
//
// One implementation for every page, because the pattern was being written by
// hand at each call site and each one forgot a different part of it: the button
// left disabled after a throw, a second click landing while the first was still
// in flight, or nothing at all announced to a screen reader.
//
// Only buttons that actually await something use this. A ring on a button whose
// work never blocks — close, copy, a weight chip — appears for one frame and
// reads as a glitch, not as progress.
//
// The ring itself is .btn-spin in app.css.

/**
 * The floor every busy button gets, so a fast answer still reads as an action
 * that happened. Raise it per call with the `minMs` option; nothing lowers it in
 * practice, and a caller that wants no floor passes 0.
 */
const MIN_BUSY_MS = 1000;

/**
 * Show the ring, disable the button, and announce it.
 *
 * The ring is inserted rather than required in the markup, so no button needs a
 * template change to gain one. `aria-busy` carries the same fact to a screen
 * reader, which cannot see the ring.
 */
export function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));

  // The original label is stashed on the element rather than in a closure, so a
  // second call while busy cannot overwrite it with the busy text and leave the
  // button saying "Copying…" for good.
  if (label) {
    if (busy) {
      if (button.dataset.idleLabel === undefined) button.dataset.idleLabel = button.textContent;
      button.textContent = label;
    } else if (button.dataset.idleLabel !== undefined) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
  }

  const ring = button.querySelector(".btn-spin");
  if (busy && !ring) {
    const el = document.createElement("span");
    el.className = "btn-spin";
    el.setAttribute("aria-hidden", "true");
    button.prepend(el);
  } else if (!busy && ring) {
    ring.remove();
  }
}

/**
 * Run `work()` with the button busy, and hand back whatever it returns.
 *
 * Rejections propagate: the caller still decides what a failure looks like on
 * screen. The button is always restored, including when `work` throws, which is
 * the part hand-written versions kept missing.
 *
 * `minMs` holds the ring open for at least that long, and defaults to one
 * second: a request that comes back in 40ms otherwise flickers the ring for two
 * frames and leaves the click looking ignored. The wait is on the button, not on
 * the work, so nothing real is made slower — a request that takes longer than
 * the floor is unaffected.
 *
 * `label` replaces the button's text while it is busy — "Copying…" on a copy
 * button. Worth it for an action that finishes instantly, where the ring alone
 * is easy to miss and the click can read as having done nothing.
 *
 * A button already busy is a no-op returning undefined, so a double click cannot
 * fire the same request twice.
 */
export async function withBusy(button, work, { minMs = MIN_BUSY_MS, label } = {}) {
  if (button?.disabled) return undefined;
  const startedAt = Date.now();
  setBusy(button, true, label);
  try {
    const result = await work();
    await remaining(startedAt, minMs);
    return result;
  } catch (err) {
    // Held for a failure too. An error painted while the ring is still turning
    // looks like it belongs to the previous attempt.
    await remaining(startedAt, minMs);
    throw err;
  } finally {
    setBusy(button, false, label);
  }
}

function remaining(startedAt, minMs) {
  const left = minMs - (Date.now() - startedAt);
  return left > 0 ? new Promise((resolve) => setTimeout(resolve, left)) : Promise.resolve();
}
