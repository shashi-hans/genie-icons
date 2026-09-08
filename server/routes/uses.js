// POST /api/uses  count one copy or download
// GET  /api/uses  the tally, admin only
//
// POST is open, because copying an icon needs no account and the page fires this
// from a beacon behind the copy button. It stores two things: an icon name and
// which of the two actions it was. No guest id is read or written here, so the
// tally stays an aggregate and never becomes a record of what one device did.
// An empty name is the resizer, which works on a file the user dropped in — the
// filename is their data, so it contributes to a total and nothing per file.
//
// Being open, the numbers can be inflated by anyone willing to post in a loop.
// The database caps how many distinct names can ever exist so a flood cannot
// fill the table; see supabase/migrations/0005_icon_uses.sql. Read the numbers
// as a popularity signal, not as a metered figure.
//
// GET is admin only, for the same reason as the country tally: which icons a
// site's users reach for is not something it needs to publish, and the review
// queue beside it is already behind that session.
import { handler, json, methodIs, readJson, requireAdmin } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { kebabName } from "../lib/validate.js";

// The most one request may add. The resizer offers a handful of sizes at once;
// nothing legitimate needs more than this from a single gesture.
const MAX_COUNT = 32;

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET", "POST")) return;

  const store = getStore();

  if (req.method === "POST") {
    // readJson hands back whatever JSON.parse produced, and a body of `null` or a
    // bare scalar is valid JSON. Folded to an object so the beacon behind
    // someone's copy button cannot turn a malformed body into a 500.
    const parsed = await readJson(req);
    const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    // Normalised rather than rejected: a name that survives kebabName is either
    // an icon or harmless, and a 400 in front of someone's copy button buys
    // nothing. An unusable name becomes "", which counts as a bare total.
    const name = kebabName(body.name);
    const action = body.action === "copy" ? "copy" : "download";
    // One gesture can export several files — the resizer's "Download all" — so a
    // count is accepted instead of a beacon per file. Clamped hard: this endpoint
    // is open, and an unbounded multiplier would let one request do what a loop
    // otherwise has to work for.
    const count = Math.min(Math.max(Math.trunc(Number(body.count) || 1), 1), MAX_COUNT);
    await store.recordIconUse(name, action, count);
    // No body: the page has nothing to do with the answer, and 204 keeps a
    // beacon from parsing one.
    res.statusCode = 204;
    return res.end();
  }

  if (!requireAdmin(req, res)) return;
  const { icons, totals } = await store.listIconUses(Number(req.query?.limit) || 100);
  return json(res, 200, { icons, totals });
});
