// Removing artwork for good, from wherever in the dashboard asks.
//
// This is the only thing in the project that deletes a drawing. It hides the
// icons from the gallery and then deletes their raw-svgs/ directories, so they
// leave the npm package on the next build and anything importing those
// components stops building. Hiding on its own — reversible, package untouched —
// is a different button, in the review queue.
//
// Shared because two views reach it: the duplicates list, and the dropped list
// an admin builds while browsing. Both need the same confirmation and the same
// reading of the answer, and a second copy of this would be the one that drifts.
//
// The confirmation is typed rather than an OK button. A dialog people dismiss by
// reflex is no gate at all in front of something this permanent.

/** What an admin has to type before anything is deleted. */
export const CONFIRM_WORD = "remove";

/** How many names to name in the prompt before summarising the rest. */
const LISTED = 12;

/**
 * Ask, then remove.
 *
 * Resolves to `{ ok: false }` when the typing did not match, and to
 * `{ ok: true, res }` when the server answered. A failed request throws, so the
 * caller can say so in its own status line.
 */
export async function confirmAndRemove(api, names) {
  if (!names.length) return { ok: false };

  const shown = names.slice(0, LISTED).join(", ");
  const rest = names.length > LISTED ? `, and ${names.length - LISTED} more` : "";
  const typed = window.prompt(
    `This removes ${names.length} ${names.length === 1 ? "icon" : "icons"} from the gallery AND deletes ` +
      `their source files, so they leave the npm package on the next build.\n\n` +
      `${shown}${rest}\n\n` +
      `Type ${CONFIRM_WORD} to confirm.`
  );
  if (typed?.trim().toLowerCase() !== CONFIRM_WORD) return { ok: false };

  const res = await api("/api/icons/remove", {
    method: "POST",
    body: JSON.stringify({ names }),
  });
  return { ok: true, res };
}

/** One line saying what the server actually did, for a status element. */
export function removalSummary(res) {
  const missing = res.missing?.length ?? 0;
  // The ordinary case reads first. A list where every name had already gone is
  // its own sentence rather than a footnote, because otherwise "0 removed from
  // the gallery" is the whole message and it looks like a failure.
  if (!res.hidden.length && missing) {
    return (
      `Nothing to remove: ${missing === 1 ? "that icon was" : `all ${missing} were`} ` +
      `already out of the catalogue. Taken off the list.`
    );
  }
  return (
    `${res.hidden.length} removed from the gallery, ` +
    `${res.removed.length} source ${res.removed.length === 1 ? "directory" : "directories"} deleted. ` +
    res.detail +
    (missing ? ` ${missing} ${missing === 1 ? "name was" : "names were"} already gone and left the list.` : "") +
    (res.error ? ` ${res.error}` : "")
  );
}
