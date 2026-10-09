// GET /api/icons/duplicates   icons that repeat each other (admin)
//
// Two kinds of repetition, reported separately because they mean different
// things:
//
//   shape   the same path data under two names. One of them is redundant —
//           unless the two are supposed to differ, in which case one is drawn
//           wrong and the fix is to redraw it, not to delete it.
//   base    the same concept from different sets. `accessibility` and
//           `accessibility-ion` are a deliberate pair: the catalogue keeps both
//           so a project can pick the drawing it prefers. This list is long and
//           mostly things to keep.
//
// Admin only. The grouping says which names the catalogue could lose, which is
// not something the gallery needs and not something to hand out.
import { handler, json, methodIs, requireAdmin } from "../lib/http.js";
import { getStore } from "../lib/store.js";
import { innerFor, seedMtime } from "../lib/icons.js";

/** What two icons must share to count as the same drawing. */
function shapeKey(icon) {
  // The centerline is the source of truth where there is one: it is the path
  // data itself, before any stroke width is applied. A drawn icon has no
  // centerline, so its regular cut stands in.
  const paths = Array.isArray(icon.centerline) ? icon.centerline : null;
  const raw = paths ? paths.join("|") : innerFor(icon, "regular");
  // Whitespace only, so a reformatted file does not read as a different drawing.
  // Nothing else is normalised: a path that differs by a coordinate is a
  // different drawing and must group separately.
  return raw.replace(/\s+/g, " ").trim();
}

// Grouping walks the whole catalogue and expands every drawn icon's weights, so
// it is held until the catalogue changes.
//
// Keyed on the catalogue's size as well as the build's timestamp. Hiding an icon
// takes it out of the catalogue without touching docs/icons.json, so a timestamp
// alone kept serving groups that still listed icons an admin had just removed —
// which read as the removal having failed.
let cached = null;
let cachedAt = -1;
let cachedSize = -1;

function group(icons) {
  const byShape = new Map();
  const byBase = new Map();

  for (const icon of icons) {
    const shape = shapeKey(icon);
    if (shape) {
      if (!byShape.has(shape)) byShape.set(shape, []);
      byShape.get(shape).push(icon);
    }
    // `base` is the name before a set code was appended to settle a clash. An
    // icon that never clashed has none, and is its own base.
    const base = icon.base || icon.name;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(icon);
  }

  /** Groups of more than one, as the names and sets an admin needs to choose. */
  const collect = (map, withKey) =>
    [...map]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({
        key: withKey ? key : undefined,
        names: list.map((icon) => ({
          name: icon.name,
          source: icon.source ?? "",
          contributed: icon.contributed === true,
        })),
      }))
      .sort((a, b) => b.names.length - a.names.length || a.names[0].name.localeCompare(b.names[0].name));

  // The shape key is the path data, which is large and of no use to the page:
  // the group is identified by what is in it.
  const shape = collect(byShape, false);
  const base = collect(byBase, true);

  const count = (groups) => groups.reduce((n, g) => n + g.names.length, 0);
  return {
    shape,
    base,
    totals: {
      shapeGroups: shape.length,
      shapeIcons: count(shape),
      // What the catalogue would lose if each group kept one member.
      shapeRedundant: shape.reduce((n, g) => n + g.names.length - 1, 0),
      baseGroups: base.length,
      baseIcons: count(base),
      catalogue: icons.length,
    },
  };
}

export default handler(async (req, res) => {
  if (!methodIs(req, res, "GET")) return;
  if (!requireAdmin(req, res)) return;

  // The catalogue is already cached by the store, so reading it to check the
  // size costs nothing; the grouping below is the expensive half.
  const icons = await getStore().listIcons();
  const at = seedMtime();
  if (!cached || at !== cachedAt || icons.length !== cachedSize) {
    cached = group(icons);
    cachedAt = at;
    cachedSize = icons.length;
  }
  return json(res, 200, cached);
});
