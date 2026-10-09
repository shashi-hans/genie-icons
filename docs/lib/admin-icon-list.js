// The dashboard's "Icon list" section: browse the catalogue, mark icons in or
// out, and take the two lists away as text.
//
// It answers a question the review queue cannot: which icons should a set
// contain. The names go on the left, the drawings on the right, and each card
// carries a + and a −. What comes out is two lists — kept, dropped — that an
// admin copies into whatever they are curating.
//
// NOTHING HERE IS SENT ANYWHERE. The two lists are a working note: they live in
// this browser, change nothing for a visitor, and hide nothing from the gallery.
// Hiding an icon is a different action with a different button, in the review
// queue. Keeping the two apart is deliberate — a bulk toggle that quietly
// republished the whole catalogue would be the easiest way to break the site by
// accident.
//
// Every name arrives in one request (/api/icons?detail=names, roughly 15 bytes a
// name) and is filtered in memory, so typing costs no request. Artwork is
// fetched a page at a time through /api/icons?names=, which is one request per
// page rather than one per icon.

// Comfortably under the 100 that /api/icons?names= will answer, and about two
// screens of cards at the width the grid uses.
const PAGE_SIZE = 60;

// The working lists survive a reload, because curating a set is a job someone
// comes back to. Per-browser, like every other localStorage key here.
const STORE_KEY = "icon-genie.admin.picks";

/** "in" for the kept list, "out" for the dropped list. */
const IN = "in";
const OUT = "out";

/**
 * Wire the section up.
 *
 * `api` is the page's own fetch helper, so this inherits its base URL, its
 * credentials and its error shape rather than having opinions of its own.
 * Returns a `load` function the dashboard's tab switcher calls.
 */
export function initIconList({ api, ids }) {
  const el = Object.fromEntries(
    Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)])
  );

  /** Every name in the catalogue, fetched once. */
  let allNames = null;
  /** Names matching the current filter, in catalogue order. */
  let filtered = [];
  let page = 0;
  /** name -> IN | OUT. A name is in at most one list. */
  let picks = readPicks();
  /** Guards against a slow page landing after a faster one. */
  let ticket = 0;

  /* --- the two lists ---------------------------------------------------- */

  function readPicks() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!raw || typeof raw !== "object") return new Map();
      return new Map(
        Object.entries(raw).filter(([, state]) => state === IN || state === OUT)
      );
    } catch {
      return new Map(); // blocked or corrupt storage is the same as no picks
    }
  }

  function savePicks() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(picks)));
    } catch {
      // Over quota or blocked. The lists still work for this visit.
    }
  }

  /**
   * Move one name between the lists.
   *
   * Pressing the button a name is already under takes it back out, so the third
   * state — undecided — is reachable without a third button.
   */
  function mark(name, state) {
    if (picks.get(name) === state) picks.delete(name);
    else picks.set(name, state);
    savePicks();
    renderPicks();
    paintState(name);
  }

  function namesIn(state) {
    return [...picks].filter(([, s]) => s === state).map(([name]) => name);
  }

  /* --- painting --------------------------------------------------------- */

  /** Reflect one name's state wherever it currently appears. */
  function paintState(name) {
    const state = picks.get(name) ?? "";
    for (const node of el.cards.querySelectorAll(`[data-name="${CSS.escape(name)}"]`)) {
      node.dataset.state = state;
      node.querySelector(".pick-in")?.setAttribute("aria-pressed", String(state === IN));
      node.querySelector(".pick-out")?.setAttribute("aria-pressed", String(state === OUT));
    }
    for (const row of el.names.querySelectorAll(`[data-name="${CSS.escape(name)}"]`)) {
      row.dataset.state = state;
    }
  }

  function renderNames(slice) {
    el.names.innerHTML = slice
      .map(
        (name) =>
          `<li class="name-row" data-name="${esc(name)}" data-state="${picks.get(name) ?? ""}">` +
          `<span class="name-dot" aria-hidden="true"></span>${esc(name)}</li>`
      )
      .join("");
  }

  function renderCards(icons) {
    el.cards.innerHTML = icons
      .map(
        (icon) =>
          `<figure class="pick-card" data-name="${esc(icon.name)}" data-state="${picks.get(icon.name) ?? ""}">` +
          `<div class="pick-btns">` +
          `<button class="pick-in" type="button" aria-pressed="false" title="Add ${esc(icon.name)} to the kept list">+</button>` +
          `<button class="pick-out" type="button" aria-pressed="false" title="Add ${esc(icon.name)} to the dropped list">−</button>` +
          `</div>` +
          `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${icon.weights?.regular ?? ""}</svg>` +
          `<figcaption>${esc(icon.name)}</figcaption></figure>`
      )
      .join("");
  }

  /** One chip group: a heading, the names, and what to do with them. */
  function chipGroup(state, label) {
    const names = namesIn(state);
    return (
      `<div class="pick-group" data-group="${state}">` +
      `<div class="pick-head">` +
      `<strong>${label} ${names.length}</strong>` +
      `<button class="btn pick-copy" type="button" data-copy="${state}"${names.length ? "" : " disabled"}>Copy names</button>` +
      `<button class="btn pick-clear" type="button" data-clear="${state}"${names.length ? "" : " disabled"}>Clear</button>` +
      `</div>` +
      `<div class="pick-chips">` +
      names
        .map(
          (name) =>
            `<span class="pick-chip">${esc(name)}` +
            `<button type="button" data-drop="${esc(name)}" title="Take ${esc(name)} off this list">×</button></span>`
        )
        .join("") +
      `</div></div>`
    );
  }

  function renderPicks() {
    const any = picks.size > 0;
    el.picks.hidden = !any;
    if (!any) {
      el.picks.innerHTML = "";
      return;
    }
    el.picks.innerHTML = chipGroup(IN, "Kept") + chipGroup(OUT, "Dropped");
  }

  /* --- the grid --------------------------------------------------------- */

  function pageCount() {
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  }

  /**
   * Draw the current page: the names on the left, then their artwork on the
   * right when it arrives.
   *
   * The names are painted first and not held back for the request, so filtering
   * feels immediate even on a slow connection.
   */
  async function showPage() {
    const mine = ++ticket;
    const start = page * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    renderNames(slice);
    el.count.textContent = filtered.length
      ? `${filtered.length.toLocaleString()} matching, showing ${start + 1}-${start + slice.length}`
      : "Nothing matches.";
    el.pager.hidden = filtered.length <= PAGE_SIZE;
    el.pageLabel.textContent = `Page ${page + 1} of ${pageCount()}`;
    el.prev.disabled = page === 0;
    el.next.disabled = page >= pageCount() - 1;

    if (!slice.length) {
      el.cards.innerHTML = "";
      return;
    }

    el.cards.setAttribute("aria-busy", "true");
    try {
      const res = await api(`/api/icons?names=${encodeURIComponent(slice.join(","))}`);
      if (mine !== ticket) return; // a later page won
      renderCards(res.icons || []);
    } catch (err) {
      if (mine !== ticket) return;
      el.cards.innerHTML = `<p class="note">Could not load the artwork (${esc(err.message)}).</p>`;
    } finally {
      if (mine === ticket) el.cards.removeAttribute("aria-busy");
    }
  }

  function applyFilter() {
    const term = el.search.value.trim().toLowerCase();
    filtered = term ? allNames.filter((name) => name.includes(term)) : allNames;
    page = 0;
    return showPage();
  }

  /* --- events ----------------------------------------------------------- */

  el.search.addEventListener("input", () => {
    if (allNames) applyFilter();
  });

  el.cards.addEventListener("click", (e) => {
    const btn = e.target.closest(".pick-in, .pick-out");
    if (!btn) return;
    mark(btn.closest(".pick-card").dataset.name, btn.classList.contains("pick-in") ? IN : OUT);
  });

  // Clicking a name marks it too, so a long list can be worked through without
  // reaching for the card. Left button keeps, as the + does.
  el.names.addEventListener("click", (e) => {
    const row = e.target.closest(".name-row");
    if (row) mark(row.dataset.name, IN);
  });

  el.picks.addEventListener("click", async (e) => {
    const drop = e.target.closest("[data-drop]");
    if (drop) {
      picks.delete(drop.dataset.drop);
      savePicks();
      renderPicks();
      paintState(drop.dataset.drop);
      return;
    }

    const clear = e.target.closest("[data-clear]");
    if (clear) {
      const state = clear.dataset.clear;
      const cleared = namesIn(state);
      for (const name of cleared) picks.delete(name);
      savePicks();
      renderPicks();
      for (const name of cleared) paintState(name);
      return;
    }

    const copy = e.target.closest("[data-copy]");
    if (copy) await copyNames(copy, namesIn(copy.dataset.copy));
  });

  el.prev.addEventListener("click", () => {
    if (page > 0) {
      page--;
      showPage();
    }
  });
  el.next.addEventListener("click", () => {
    if (page < pageCount() - 1) {
      page++;
      showPage();
    }
  });

  /* --- entry point ------------------------------------------------------ */

  /** Drop the cached name list, so the next load asks the server again. */
  function forget() {
    allNames = null;
  }

  async function load() {
    el.block.hidden = false;
    renderPicks();
    if (allNames) return showPage();

    el.note.textContent = "Loading the catalogue…";
    try {
      const res = await api("/api/icons?detail=names");
      allNames = res.names || [];
      el.note.textContent =
        `${allNames.length.toLocaleString()} icons. + keeps one, − drops it, and clicking either again undoes it. ` +
        `Both lists stay in this browser and change nothing for visitors.`;
      await applyFilter();
    } catch (err) {
      el.note.textContent = `Could not load the icon names (${err.message}).`;
    }
  }

  return { load, forget };
}

/** Copy to the clipboard, saying so on the button that asked. */
async function copyNames(btn, names) {
  const text = names.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy names"), 1200);
  } catch {
    // No clipboard permission, or an insecure origin. Showing the text is still
    // a way to get it out.
    window.prompt("Copy the names", text);
  }
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
