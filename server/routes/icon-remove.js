// POST /api/icons/remove   { "names": [...] }   take icons out for good (admin)
//
// The permanent counterpart to DELETE /api/icons/:name, which only hides.
// Hiding leaves the artwork in raw-svgs/ and in the npm package and is one call
// from being undone; this deletes the source files, so the icon leaves the
// package on the next build and an app importing that component fails to build.
//
// Both happen here, in that order. Hiding first is what makes the gallery agree
// with the decision immediately: the catalogue is read from docs/icons.json,
// which still lists an icon whose files are gone until the next
// `npm run build:icons`. If the delete then fails — a read-only filesystem with
// no token — the icons are at least out of the site, and the response says so
// rather than claiming a removal that did not happen.
//
// Admin only, and capped at MAX_NAMES below.
import { handler, json, methodIs, readJson, requireAdmin, HttpError } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { kebabName } from "../lib/validate.js";
import { removeIconArtwork } from "../lib/publish.js";

// A whole pass over the duplicates list is around a thousand names, and sending
// it as ten requests would mean ten commits and ten rebuilds on a deployed site.
// The ceiling is here to stop a hand-written request asking for the catalogue,
// not to pace an admin working through the list.
const MAX_NAMES = 2000;

export default handler(async (req, res) => {
  if (!methodIs(req, res, "POST")) return;
  if (!requireAdmin(req, res)) return;

  const body = await readJson(req);
  const raw = Array.isArray(body?.names) ? body.names : null;
  if (!raw || !raw.length) throw new HttpError(400, 'Send {"names": ["icon-name", …]}.');
  if (raw.length > MAX_NAMES) {
    throw new HttpError(400, `At most ${MAX_NAMES} icons at a time; ${raw.length} were sent.`);
  }

  // Through the same name filter every other icon route uses, so nothing here
  // can address a path outside raw-svgs/.
  const names = [...new Set(raw.map(kebabName).filter(Boolean))];
  if (!names.length) throw new HttpError(400, "No usable icon names in that list.");

  const store = getStore();

  // Against the catalogue in one pass rather than hasIcon per name: a selection
  // of a thousand would otherwise be a thousand round trips to the store.
  const known = new Set((await store.listIcons()).map((icon) => icon.name));
  const missing = names.filter((name) => !known.has(name));
  if (missing.length === names.length) {
    throw new HttpError(404, `No such icons: ${missing.slice(0, 10).join(", ")}.`);
  }

  // A name the catalogue does not have cannot be hidden, and has no files to
  // delete either, so it is reported rather than failing the whole request.
  const present = names.filter((name) => known.has(name));
  // In one round trip. Hiding them one at a time meant several hundred calls to
  // the store for a single press, which is past the time a deployed function is
  // given before it is cut off.
  await store.hideIcons(present, "admin");

  const removal = await removeIconArtwork(present);

  return json(res, 200, {
    hidden: present,
    removed: removal.removed,
    missing,
    mode: removal.mode,
    url: removal.url,
    detail: removal.detail,
    error: removal.error,
  });
});
