// The dashboard's duplicates view: icons that repeat each other, and the one
// control in this project that removes artwork for good.
//
// TWO LISTS, TWO MEANINGS.
//
//   Same drawing   identical path data under two names. Usually one name too
//                  many — but sometimes the opposite, a pair that is supposed
//                  to differ and does not, which is a drawing to fix rather
//                  than a name to delete. The page says so rather than deciding.
//   Same base name the same concept from different sets, kept on purpose so a
//                  project can choose the drawing it prefers. Long list, mostly
//                  things to keep, which is why it is paged and filtered.
//
// DELETING IS PERMANENT. It hides the icons from the gallery and then removes
// their raw-svgs/ directories, so they leave the npm package on the next build
// and anything importing those components stops building. That is why there is
// a typed confirmation rather than a plain OK, and why the response is shown in
// full: locally a file delete, on a deployed site a commit to the default
// branch. Hiding alone — reversible, package untouched — is the button in the
// review queue.
import { withBusy } from "./busy.js";

// Groups per page in the base-name list. Each group is 2-5 icons, so a page is
// a few dozen cards.
const GROUPS_PER_PAGE = 15;

// What /api/icons?names= will answer in one request. Names past it are dropped
// by the server rather than refused, so the client has to do the splitting.
const NAMES_PER_REQUEST = 100;

/** What an admin has to type to confirm a removal. */
const CONFIRM_WORD = "remove";

// Working through 900 groups is not one sitting, and the selection used to live
// only in this page's memory: a reload, or a failed removal followed by a
// refresh, threw away an hour of picking.
const STORE_KEY = "icon-genie.admin.dupes";

export function initDuplicates({ api, ids, onRemoved }) {
  const el = Object.fromEntries(
    Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)])
  );

  let data = null;
  /** "shape" or "base". */
  let which = "shape";
  let page = 0;
  let filter = "";
  /** Names ticked for removal, across pages and across visits. */
  const chosen = new Set(readChosen());
  /** Set by every change to `chosen`, so a plain redraw does not rewrite storage. */
  let dirty = false;
  /** Artwork by name, kept so paging back does not refetch. */
  const art = new Map();
  let ticket = 0;

  /* --- what is on screen ------------------------------------------------ */

  function groups() {
    const all = which === "shape" ? data.shape : data.base;
    if (!filter) return all;
    return all.filter((g) => g.names.some((n) => n.name.includes(filter)));
  }

  function pageCount() {
    return Math.max(1, Math.ceil(groups().length / GROUPS_PER_PAGE));
  }

  function pageGroups() {
    return groups().slice(page * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE + GROUPS_PER_PAGE);
  }

  /* --- drawing ---------------------------------------------------------- */

  function cardHtml(entry) {
    const markup = art.get(entry.name) ?? "";
    return (
      `<label class="dupe-card${chosen.has(entry.name) ? " picked" : ""}" data-name="${esc(entry.name)}">` +
      `<input type="checkbox" ${chosen.has(entry.name) ? "checked" : ""} />` +
      `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${markup}</svg>` +
      `<span class="dupe-name">${esc(entry.name)}</span>` +
      `<span class="dupe-set">${esc(entry.source || "—")}</span>` +
      `</label>`
    );
  }

  function render() {
    const list = pageGroups();
    el.groups.innerHTML = list.length
      ? list
          .map(
            (g) =>
              `<div class="dupe-group">` +
              `<div class="dupe-key">${esc(g.key ?? g.names.map((n) => n.name).join(" = "))}` +
              `<button class="btn dupe-keep" type="button" data-keepfirst="${esc(g.names.map((n) => n.name).join(","))}">Select all but the first</button>` +
              `</div>` +
              `<div class="dupe-cards">${g.names.map(cardHtml).join("")}</div>` +
              `</div>`
          )
          .join("")
      : `<p class="note">Nothing matches that filter.</p>`;

    const found = groups().length;
    // The count first and the page after it, separated by a dash rather than a
    // comma: "Page 1 of 63, 933 groups" read as one number, 63,933.
    el.pageLabel.textContent =
      `${found.toLocaleString()} ${found === 1 ? "group" : "groups"} — page ${page + 1} of ${pageCount()}`;
    el.prev.disabled = page === 0;
    el.next.disabled = page >= pageCount() - 1;
    renderChosen();
  }

  function renderChosen() {
    el.chosenCount.textContent = chosen.size
      ? `${chosen.size.toLocaleString()} selected for removal`
      : "Nothing selected.";
    el.remove.disabled = chosen.size === 0;
    el.clear.disabled = chosen.size === 0;
    if (el.copy) el.copy.disabled = chosen.size === 0;
    // Saved here rather than at every caller, but only when the set has actually
    // moved: renderChosen also runs on every page turn, and serialising a
    // thousand names to storage to redraw a label is work for nothing.
    if (dirty) {
      saveChosen();
      dirty = false;
    }
  }

  function readChosen() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((n) => typeof n === "string") : [];
    } catch {
      return [];
    }
  }

  function saveChosen() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...chosen]));
    } catch {
      // Blocked or over quota. The selection still works for this visit.
    }
  }

  /** Fetch the artwork this page needs, then redraw the cards that gained it. */
  async function fillArt() {
    const mine = ++ticket;
    const wanted = [
      ...new Set(pageGroups().flatMap((g) => g.names.map((n) => n.name)).filter((n) => !art.has(n))),
    ];
    if (!wanted.length) return;
    try {
      // In batches, because /api/icons?names= answers at most NAMES_PER_REQUEST
      // and silently drops the rest: a page of groups large enough to pass it
      // rendered its last few cards with no drawing and nothing to say why.
      for (let i = 0; i < wanted.length; i += NAMES_PER_REQUEST) {
        const batch = wanted.slice(i, i + NAMES_PER_REQUEST);
        const res = await api(`/api/icons?names=${encodeURIComponent(batch.join(","))}`);
        if (mine !== ticket) return;
        for (const icon of res.icons || []) art.set(icon.name, icon.weights?.regular ?? "");
      }
      render();
    } catch {
      // The names and the checkboxes are the working part; a missing drawing is
      // a worse page, not a broken one.
    }
  }

  async function show() {
    render();
    await fillArt();
  }

  /* --- events ----------------------------------------------------------- */

  el.subtabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-dupes]");
    if (!btn || !data) return;
    for (const b of el.subtabs.querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b === btn));
    }
    which = btn.dataset.dupes;
    page = 0;
    show();
  });

  el.search.addEventListener("input", () => {
    if (!data) return;
    filter = el.search.value.trim().toLowerCase();
    page = 0;
    show();
  });

  el.groups.addEventListener("click", (e) => {
    const keep = e.target.closest("[data-keepfirst]");
    if (keep) {
      // The first name in a group is the one the catalogue reached for first, so
      // it is the sensible one to keep. Nothing is removed by this: it ticks
      // boxes, and the removal is still a separate, confirmed press.
      const [, ...rest] = keep.dataset.keepfirst.split(",");
      for (const name of rest) chosen.add(name);
      dirty = true;
      render();
      return;
    }
    const card = e.target.closest(".dupe-card");
    if (!card) return;
    // The label's own click already toggles the checkbox; read it afterwards.
    queueMicrotask(() => {
      const on = card.querySelector("input").checked;
      if (on) chosen.add(card.dataset.name);
      else chosen.delete(card.dataset.name);
      dirty = true;
      card.classList.toggle("picked", on);
      renderChosen();
    });
  });

  // Every group at once, not just the ones on this page. Working through 933
  // groups a page at a time is an hour of clicking for a decision that is the
  // same in each group: keep the first, drop the rest.
  el.selectAll?.addEventListener("click", () => {
    for (const g of groups()) for (const n of g.names.slice(1)) chosen.add(n.name);
    dirty = true;
    render();
  });

  el.clear.addEventListener("click", () => {
    chosen.clear();
    dirty = true;
    render();
  });

  // The way a long selection leaves this page without being removed: a failed
  // removal used to mean retyping the names by hand, or picking them again.
  el.copy?.addEventListener("click", async () => {
    const text = [...chosen].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      el.copy.textContent = "Copied";
      setTimeout(() => (el.copy.textContent = "Copy selected"), 1200);
    } catch {
      window.prompt("Copy the selected names", text);
    }
  });

  el.prev.addEventListener("click", () => {
    if (page > 0) {
      page--;
      show();
    }
  });
  el.next.addEventListener("click", () => {
    if (page < pageCount() - 1) {
      page++;
      show();
    }
  });

  el.remove.addEventListener("click", () =>
    withBusy(el.remove, async () => {
      const names = [...chosen];
      const typed = window.prompt(
        `This removes ${names.length} ${names.length === 1 ? "icon" : "icons"} from the gallery AND deletes ` +
          `their source files, so they leave the npm package on the next build.\n\n` +
          `${names.slice(0, 12).join(", ")}${names.length > 12 ? `, and ${names.length - 12} more` : ""}\n\n` +
          `Type ${CONFIRM_WORD} to confirm.`
      );
      if (typed?.trim().toLowerCase() !== CONFIRM_WORD) {
        el.status.textContent = "Nothing was removed.";
        return;
      }

      try {
        const res = await api("/api/icons/remove", {
          method: "POST",
          body: JSON.stringify({ names }),
        });
        for (const name of res.hidden) {
          chosen.delete(name);
          art.delete(name);
          dirty = true;
        }
        // Refetched, not reloaded. Reloading the page threw this result away
        // before it could be read, which made a removal that had worked look
        // like one that had done nothing.
        data = null;
        await load();
        onRemoved?.(res);
        // After load(), which writes its own summary into the note. Setting the
        // status first meant the reload of the groups wiped it.
        el.status.textContent =
          `${res.hidden.length} removed from the gallery, ` +
          `${res.removed.length} source ${res.removed.length === 1 ? "directory" : "directories"} deleted. ` +
          res.detail +
          (res.missing?.length ? ` Not found: ${res.missing.join(", ")}.` : "") +
          (res.error ? ` ${res.error}` : "");
      } catch (err) {
        el.status.textContent = `Nothing was removed: ${err.message}`;
      }
    }, { label: "Removing…" })
  );

  /* --- entry point ------------------------------------------------------ */

  async function load() {
    el.block.hidden = false;
    if (data) return show();
    el.note.textContent = "Comparing every icon…";
    try {
      data = await api("/api/icons/duplicates");
      const t = data.totals;
      el.note.textContent =
        `${t.shapeGroups} groups share a drawing (${t.shapeIcons} icons, ${t.shapeRedundant} redundant). ` +
        `${t.baseGroups.toLocaleString()} share a base name (${t.baseIcons.toLocaleString()} icons) — those are ` +
        `the same concept from different sets and are usually worth keeping. ` +
        `A pair that should differ but shares a drawing is a drawing to fix, not a name to delete.`;
      await show();
    } catch (err) {
      el.note.textContent = `Could not compare the icons (${err.message}).`;
    }
  }

  return load;
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
