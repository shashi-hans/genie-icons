// The dashboard's "Icon list" section: browse the catalogue and mark the icons
// to drop.
//
// It answers a question the review queue cannot: which icons should the
// catalogue stop carrying. The names go on the left, the drawings on the right,
// and each card carries a −. What comes out is one list, which an admin copies
// out or removes outright.
//
// One list, not two. There was a + building a kept list beside it, and it earned
// nothing: everything not dropped is kept, so the second list restated the
// catalogue and gave every card a decision where there was only ever one.
//
// THE LIST ITSELF GOES NOWHERE. It lives in this browser, changes nothing for a
// visitor, and hides nothing from the gallery; marking an icon is a note to
// self, which is why it needs no confirmation and no undo beyond pressing the
// button again.
//
// One button is the exception, and it is the only thing on this page that is:
// Remove selected. It deletes that artwork for good, asks for a typed
// confirmation, and goes through the same helper the duplicates view uses so the
// two cannot come to mean different things.
//
// Every name arrives in one request (/api/icons?detail=names, roughly 15 bytes a
// name) and is filtered in memory, so typing costs no request. Artwork is
// fetched a page at a time through /api/icons?names=, which is one request per
// page rather than one per icon.
import { withBusy } from "./busy.js";
import { confirmAndRemove, removalSummary } from "./admin-remove.js";

// Comfortably under the 100 that /api/icons?names= will answer, and about two
// screens of cards at the width the grid uses.
const PAGE_SIZE = 60;

// The working lists survive a reload, because curating a set is a job someone
// comes back to. Per-browser, like every other localStorage key here.
const STORE_KEY = "icon-genie.admin.picks";

/** The one state a name can be in, and the value the markup carries for it. */
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
  /** The set code for each name, parallel to allNames. */
  let sourceOf = new Map();
  /** Set code to the name to show, from the catalogue. */
  let setNames = {};
  /** The set currently being browsed, or "" for all of them. */
  let source = "";
  /** Names matching the current filter, in catalogue order. */
  let filtered = [];
  let page = 0;
  /** The names marked to drop. */
  let picks = readPicks();
  /** Guards against a slow page landing after a faster one. */
  let ticket = 0;

  /* --- the dropped list ------------------------------------------------- */

  /**
   * The stored list, as a Set of names.
   *
   * An array now. It used to be an object of name to "in" or "out", and a
   * browser that was mid-list when the kept list went away still holds one, so
   * that shape is read for its dropped names rather than discarded.
   */
  function readPicks() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (Array.isArray(raw)) return new Set(raw.filter((n) => typeof n === "string"));
      if (raw && typeof raw === "object") {
        return new Set(Object.entries(raw).filter(([, state]) => state === OUT).map(([name]) => name));
      }
      return new Set();
    } catch {
      return new Set(); // blocked or corrupt storage is the same as no picks
    }
  }

  function savePicks() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...picks]));
    } catch {
      // Over quota or blocked. The list still works for this visit.
    }
  }

  /**
   * Mark a name to drop, or take it back off the list.
   *
   * One button and two states, so pressing it again is the undo.
   */
  function mark(name) {
    if (picks.has(name)) picks.delete(name);
    else picks.add(name);
    savePicks();
    renderPicks();
    paintState(name);
  }

  function droppedNames() {
    return [...picks];
  }

  /* --- painting --------------------------------------------------------- */

  /** Reflect one name's state wherever it currently appears. */
  function paintState(name) {
    const state = picks.has(name) ? OUT : "";
    for (const node of el.cards.querySelectorAll(`[data-name="${CSS.escape(name)}"]`)) {
      node.dataset.state = state;
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
          `<li class="name-row" data-name="${esc(name)}" data-state="${picks.has(name) ? OUT : ""}">` +
          `<span class="name-dot" aria-hidden="true"></span>${esc(name)}</li>`
      )
      .join("");
  }

  function renderCards(icons) {
    el.cards.innerHTML = icons
      .map(
        (icon) =>
          `<figure class="pick-card" data-name="${esc(icon.name)}" data-state="${picks.has(icon.name) ? OUT : ""}">` +
          `<div class="pick-btns">` +
          `<button class="pick-out" type="button" aria-pressed="false" title="Add ${esc(icon.name)} to the dropped list">−</button>` +
          `</div>` +
          `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${icon.weights?.regular ?? ""}</svg>` +
          `<figcaption>${esc(icon.name)}` +
          // Which set drew it, under the name. Browsing by set is no use if the
          // card does not say which set it is looking at.
          `<span class="pick-set">${esc(setNames[icon.source] || icon.source || "—")}</span>` +
          `</figcaption></figure>`
      )
      .join("");
  }

  /** The dropped list: a heading, the names, and what to do with them. */
  function chipGroup() {
    const names = droppedNames();
    return (
      `<div class="pick-group" data-group="${OUT}">` +
      `<div class="pick-head">` +
      `<strong>Dropped ${names.length}</strong>` +
      `<button class="btn pick-copy" type="button" data-copy="${OUT}"${names.length ? "" : " disabled"}>Copy names</button>` +
      `<button class="btn pick-clear" type="button" data-clear="${OUT}"${names.length ? "" : " disabled"}>Clear</button>` +
      `<button class="btn bad pick-remove" type="button" data-remove="${OUT}"${names.length ? "" : " disabled"}>Remove selected</button>` +
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

  /**
   * Say what happened beside the lists, not in the section note.
   *
   * The button is at the foot of a long page and the note is at its head, so a
   * result written up there was off screen at the moment it mattered — which is
   * how a removal that reported "those were already gone" looked like a button
   * that did nothing.
   */
  function setPicksStatus(text) {
    if (el.picksStatus) el.picksStatus.textContent = text;
    else el.note.textContent = text;
  }

  function renderPicks() {
    const any = picks.size > 0;
    el.picks.hidden = !any;
    if (!any) {
      el.picks.innerHTML = "";
      return;
    }
    el.picks.innerHTML = chipGroup();
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
    // Both narrowings at once, so picking Tabler and typing "arrow" means Tabler
    // arrows rather than whichever was chosen last.
    filtered = allNames.filter(
      (name) => (!term || name.includes(term)) && (!source || sourceOf.get(name) === source)
    );
    page = 0;
    return showPage();
  }

  /**
   * Fill the set picker from the catalogue itself.
   *
   * Built from what the names response actually carries rather than a list
   * written here, so a set added or emptied later needs no edit: it appears, or
   * stops appearing, on its own. Counts are in the labels because the useful
   * question is usually how much of the catalogue a set accounts for.
   */
  function renderSources() {
    if (!el.source) return;
    const counts = new Map();
    for (const code of sourceOf.values()) counts.set(code, (counts.get(code) ?? 0) + 1);
    // Removing the last icon of a set takes the set with it. Without this the
    // dropdown falls back to showing "All sources" while the filter is still
    // pinned to a code nothing has, so the grid goes empty and the control says
    // it is not filtering.
    if (source && !counts.has(source)) source = "";
    const options = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([code, n]) =>
          `<option value="${esc(code)}"${code === source ? " selected" : ""}>` +
          `${esc(setNames[code] || code || "No source")} (${n.toLocaleString()})</option>`
      )
      .join("");
    el.source.innerHTML =
      `<option value=""${source ? "" : " selected"}>All sources (${allNames.length.toLocaleString()})</option>` +
      options;
  }

  /* --- events ----------------------------------------------------------- */

  el.search.addEventListener("input", () => {
    if (allNames) applyFilter();
  });

  el.source?.addEventListener("change", () => {
    source = el.source.value;
    if (allNames) applyFilter();
  });

  el.cards.addEventListener("click", (e) => {
    if (e.target.closest(".pick-out")) mark(e.target.closest(".pick-card").dataset.name);
  });

  // Clicking a name does the same, so a long list can be worked through without
  // reaching for the card.
  el.names.addEventListener("click", (e) => {
    const row = e.target.closest(".name-row");
    if (row) mark(row.dataset.name);
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
      const cleared = droppedNames();
      for (const name of cleared) picks.delete(name);
      savePicks();
      renderPicks();
      for (const name of cleared) paintState(name);
      return;
    }

    const copy = e.target.closest("[data-copy]");
    if (copy) {
      await copyNames(copy, droppedNames());
      return;
    }

    const remove = e.target.closest("[data-remove]");
    if (remove) await removeDropped(remove);
  });

  /**
   * Delete the artwork for everything on the dropped list.
   *
   * The same confirmation and the same endpoint the duplicates view uses, so the
   * two cannot drift apart. What is removed leaves both the list and the
   * catalogue, so the name list is dropped and refetched rather than patched:
   * the page is now looking at a smaller catalogue than the one it loaded.
   */
  async function removeDropped(btn) {
    await withBusy(
      btn,
      async () => {
        try {
          const { ok, res } = await confirmAndRemove(api, droppedNames());
          if (!ok) {
            setPicksStatus("Nothing was removed.");
            return;
          }
          // Both what went and what had already gone. A name the catalogue does
          // not have cannot be removed again, so leaving it on a list of icons
          // to remove means pressing the button forever and nothing happening.
          for (const name of [...res.hidden, ...(res.missing ?? [])]) picks.delete(name);
          savePicks();
          renderPicks();
          forget();
          await load();
          setPicksStatus(removalSummary(res));
        } catch (err) {
          setPicksStatus(`Nothing was removed: ${err.message}`);
        }
      },
      { label: "Removing…" }
    );
  }

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
      // The response carries the set codes parallel to the names, so one request
      // still answers both the list and the picker.
      sourceOf = new Map(allNames.map((name, i) => [name, (res.sources || [])[i] ?? ""]));
      setNames = res.sets || {};
      renderSources();
      el.note.textContent =
        `${allNames.length.toLocaleString()} icons. − marks one to drop, and pressing it again undoes that. ` +
        `The list stays in this browser until you copy it out or remove the artwork.`;
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
