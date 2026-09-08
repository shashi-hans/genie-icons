// The icon catalogue the gallery reads from.
//
// Built icons are seeded from docs/icons.json, which `npm run build:icons`
// generates from raw-svgs/. Git stays the source of truth for artwork; this is
// the serving copy. Approved contributions are added on top, which is what makes
// an approval visible immediately instead of at the next build.
//
// Served a page at a time, filtered and sliced in server/routes/icons.js: the
// catalogue is far too large to hand to a browser whole.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
// One derivation for Node, shared with the build. The library's runtime copy is
// src/StrokeIcon.tsx (TypeScript, and published, so it cannot import from here)
// and the browser's is docs/stroke-weights.js; all three carry the same widths,
// named in each file's header.
import { deriveWeightInner } from "../../scripts/derive-weights.js";
// One kebab-to-Pascal rule for Node, shared with the build, for the same reason:
// the component name the API reports for an approved icon has to be the one the
// build will actually emit for it.
import { toPascalCase } from "../../scripts/utils.js";

// server/lib -> server -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED = join(ROOT, "docs", "icons.json");

// What the API serves. Mirrors scripts/utils.js.
export const WEIGHTS = ["thin", "regular", "bold", "fill", "duotone"];

// The weight files that exist under raw-svgs/. Used for recognising built
// artwork on disk, which is a different question from what the API serves.
export const SOURCE_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];

/**
 * Read the built catalogue. Returns [] when the build has not run yet.
 *
 * A stroke icon is stored as its centerline paths only, so its weights are
 * derived here. Keeping both in the file cost 12 MB of markup that is a pure
 * function of 1 MB of source.
 */
export function readSeed() {
  try {
    const data = JSON.parse(readFileSync(SEED, "utf8"));
    if (!Array.isArray(data.icons)) return [];
    for (const icon of data.icons) {
      if (icon.kind === "stroke" && !icon.weights && icon.centerline) {
        icon.weights = deriveWeightInner(icon.centerline);
      }
    }
    return data.icons;
  } catch {
    return [];
  }
}

/**
 * Set code to display name, as the build wrote it: {"tb": "Tabler", ...}.
 *
 * An icon carries the code, so the page needs this to show which set drew it.
 * Small enough to send with every page of results, and it has to be: the gallery
 * pages through the catalogue and any page can hold icons from any set. Returns
 * {} before the first build, which reads as "source unknown" rather than
 * breaking the grid.
 *
 * Cached against the catalogue's mtime, the same way isBuiltIcon caches its name
 * set. /api/icons calls this on every request, including every keystroke of a
 * search, and the table it wants is a dozen entries at the end of a 7 MB file —
 * so parsing the file per request spent megabytes of work to read bytes of it.
 */
/** @type {Record<string,string>|null} */
let setNames = null;
let setNamesAt = -1;

export function readSetNames() {
  const at = seedMtime();
  if (setNames && at === setNamesAt) return setNames;
  try {
    const data = JSON.parse(readFileSync(SEED, "utf8"));
    setNames = data.sets && typeof data.sets === "object" ? data.sets : {};
  } catch {
    setNames = {};
  }
  setNamesAt = at;
  return setNames;
}

/**
 * Modification time of the built catalogue, or 0 when it is not there.
 *
 * Callers that cache anything derived from readSeed() compare this and rebuild
 * when it moves. Without it a running server keeps serving the catalogue it read
 * at boot, so every `npm run build:icons` needs a restart to show up.
 */
export function seedMtime() {
  try {
    return statSync(SEED).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * One weight's inner SVG markup for one icon, whichever kind it is.
 *
 * A drawn icon carries its weights already; a stroke icon that is not carrying
 * them is expanded from its centerline paths here. Falls back to regular for a
 * weight the icon has nothing for, and to "" when it has nothing at all.
 */
export function innerFor(icon, weight) {
  const weights = icon.weights ?? (icon.centerline ? deriveWeightInner(icon.centerline) : null);
  if (!weights) return "";
  return weights[weight] || weights.regular || "";
}


export { deriveWeightInner, toPascalCase };

/**
 * Just the names of the built icons, without deriving any weights.
 *
 * readSeed() expands 4,053 centerline icons into their four weights, roughly
 * 40MB of markup allocated and then dropped when the caller only wants to know
 * which names exist.
 */
function readSeedNames() {
  try {
    const data = JSON.parse(readFileSync(SEED, "utf8"));
    if (!Array.isArray(data.icons)) return [];
    return data.icons.filter((icon) => !icon.contributed).map((icon) => icon.name);
  } catch {
    return [];
  }
}

// Cached because readSeedNames() parses several megabytes and isBuiltIcon sits
// on the path of every contribution. Keyed on the catalogue's mtime so a rebuild
// is picked up without restarting the process.
/** @type {Set<string>|null} */
let builtNames = null;
let builtNamesAt = -1;

/**
 * True when `name` belongs to an icon the package already builds from
 * raw-svgs/, as opposed to an approved contribution.
 *
 * The build reads a centerline file in preference to a directory's six weight
 * files, so publishing a contribution under a built icon's name would replace
 * the shipped drawing. The submission API refuses the name for that reason.
 */
export function isBuiltIcon(name) {
  const at = seedMtime();
  if (!builtNames || at !== builtNamesAt) {
    builtNames = new Set(readSeedNames());
    builtNamesAt = at;
  }
  return builtNames.has(name);
}

/** Build a catalogue entry from an approved submission. */
export function iconFromSubmission(submission) {
  return {
    name: submission.name,
    component: toPascalCase(submission.name),
    kind: "stroke",
    contributed: true,
    contributor: submission.contributor || "Anonymous",
    submissionId: submission.id,
    centerline: submission.paths,
    weights: deriveWeightInner(submission.paths),
  };
}
