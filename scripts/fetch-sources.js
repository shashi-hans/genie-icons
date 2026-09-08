// Fetch one SVG per icon from all sixteen sets in scripts/sources.js and stage
// them, with their provenance recorded, for review against raw-svgs/.
//
//   node scripts/fetch-sources.js                  every set
//   node scripts/fetch-sources.js bootstrap radix   only these
//   node scripts/fetch-sources.js --no-clone        reuse the cache, fetch nothing
//
// Each repository is cloned shallow into .icon-sources/<key>/ with a sparse
// checkout of just its SVG directory, so a monorepo like Carbon does not bring
// its whole history and packages along. The cache is gitignored; deleting it
// costs one slow run.
//
// WHAT THIS WRITES
//
//   raw-svgs-incoming/<name>/<name>-regular.svg  the artwork, on the 256 grid
//   raw-svgs-incoming/<name>/source.json         { source, base, licence, file }
//
// A staging tree, not raw-svgs/, and gitignored. raw-svgs/ holds two things this
// must not overwrite: 4,053 centerline icons that came from this project's own
// generator and exist in no upstream set, and 4,415 imported icons that each
// ship six weights. What a set gives us here is one weight, so merging on top of
// those would trade six real cuts of a drawing for one and silently downgrade
// `weight="fill"` for every icon it touched. Compare the two trees, decide the
// merge, then move them across deliberately.
//
// The name is the icon's own when only one set draws it. When several draw it,
// the PRIORITY list below decides who keeps the bare name and the rest carry the
// set's code: `home` drawn by Phosphor, Lucide and Bootstrap becomes `home`
// (Phosphor), `home-lu` and `home-bs`. Ranking rather than suffixing all of them
// means the default import always exists and always comes from the same set.
// `source.json` keeps the bare name in `base`, which is what groups the copies
// back together for the review screen.
//
// One weight per icon, because that is all most of these sets ship. A single
// `-regular.svg` reads as a drawn icon with one weight to the rest of the
// pipeline, and innerFor() already falls back to regular for a weight an icon
// does not have, so `weight="fill"` renders the outline rather than nothing.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, kebabName } from "./utils.js";
import { SOURCES } from "./sources.js";
import { normalise } from "./svg-normalise.js";

const CACHE_DIR = path.join(ROOT, ".icon-sources");
const OUT_DIR = path.join(ROOT, "raw-svgs-incoming");

const args = process.argv.slice(2);
const noClone = args.includes("--no-clone");
const only = new Set(args.filter((a) => !a.startsWith("--")));
const selected = only.size ? SOURCES.filter((s) => only.has(s.key)) : SOURCES;

if (!selected.length) {
  console.error(
    `No set matched. Known keys: ${SOURCES.map((s) => s.key).join(", ")}`
  );
  process.exit(1);
}

// A set cannot be imported until its licence text is in the tree.
//
// The registry lists more sets than the catalogue currently uses, which is
// useful as a menu, and LICENSES/ holds only the ones actually shipped. Without
// this check the default run would import all sixteen and redistribute artwork
// whose licence text is nowhere in the package — the Apache-2.0 sets especially,
// where the text is a condition of redistribution. Refused rather than warned:
// the artwork would already be on disk by the time anyone read a warning.
const missingLicence = selected.filter(
  (s) => !fs.existsSync(path.join(ROOT, "LICENSES", `${s.key}.txt`))
);
if (missingLicence.length) {
  console.error(
    `No licence text for ${missingLicence.map((s) => s.key).join(", ")}.\n` +
      `Add LICENSES/<key>.txt — a verbatim copy of the LICENSE file in the upstream\n` +
      `repo — and add the copyright notice to LICENSE, before importing the artwork.\n` +
      `Both ship in the npm tarball and are what makes redistribution permitted.`
  );
  process.exit(1);
}

// Whether a name gets a source suffix depends on how many sets draw it, so the
// answer is only right when every set that can be imported is in the same run.
//
// Compared against the licensed sets, not the whole registry: the registry lists
// sets whose licence text is not in the tree, and those cannot be imported at
// all, so their absence is not what makes a name look uncontested. Naming a
// strict subset is for checking one set's `pick` rule, and the tree it leaves
// behind must not be merged into raw-svgs/.
const licensed = SOURCES.filter((s) =>
  fs.existsSync(path.join(ROOT, "LICENSES", `${s.key}.txt`))
);
if (selected.length < licensed.length) {
  console.warn(
    `Only ${selected.length} of the ${licensed.length} licensed sets selected. Names will be ` +
      `wrong: an icon looks uncontested when the sets that also draw it are not in the run. ` +
      `Use this to check a pick rule, not to build a tree worth keeping.\n`
  );
}

/* --- fetching ------------------------------------------------------------- */

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/**
 * Shallow, sparse clone of one set, or a pull when it is already cached.
 *
 * Sparse because several of these are monorepos: Carbon's SVGs are one directory
 * inside a design system with hundreds of packages, and Material Symbols carries
 * every icon at four sizes in three styles.
 */
function ensureClone(source) {
  const dir = path.join(CACHE_DIR, source.key);
  const url = `https://github.com/${source.repo}.git`;

  if (fs.existsSync(path.join(dir, ".git"))) {
    if (noClone) return dir;
    try {
      // The filter is repeated here, not only on the first fetch. A cached clone
      // whose config carries no remote.origin.partialclonefilter would otherwise
      // refresh with every blob in the commit — the 11GB Material Symbols case
      // the initial fetch below exists to avoid.
      git(["fetch", "--depth", "1", "--filter=blob:none", "origin", "HEAD"], dir);
      git(["reset", "--hard", "FETCH_HEAD"], dir);
      return dir;
    } catch (err) {
      console.warn(`  ${source.key}: refresh failed, using the cached copy (${err.message.trim()})`);
      return dir;
    }
  }

  if (noClone) return fs.existsSync(dir) ? dir : null;

  fs.mkdirSync(dir, { recursive: true });
  git(["init", "--quiet"], dir);
  git(["remote", "add", "origin", url], dir);
  // The SVG directory only. `--no-cone` allows a path this deep to be named
  // directly, which cone mode cannot do.
  git(["config", "core.sparseCheckout", "true"], dir);
  git(["sparse-checkout", "set", "--no-cone", source.sparse ?? `/${source.svgDir}/*`], dir);
  // `--filter=blob:none` is what keeps this small, and sparse-checkout alone does
  // not. Sparse checkout limits which files are written to the working tree;
  // `--depth 1` still downloads every blob in the commit. Material Symbols ships
  // every icon at four sizes in three styles plus the fonts, and a depth-1 clone
  // of it is 11GB. With the filter, blobs arrive lazily and only the checkout's
  // own paths are ever asked for, which brings it to 1.7GB.
  //
  // It is still the largest by far, because 42 files per icon match even the
  // narrowed pattern: `abc_24px.svg` sits beside `abc_fill1_24px.svg`,
  // `abc_grad200_24px.svg` and the rest of the axis variants. A gitignore-style
  // pattern cannot say "the file named after its own directory", so the variants
  // are checked out and then dropped by this set's `pick`.
  git(["fetch", "--depth", "1", "--filter=blob:none", "origin", "HEAD"], dir);
  git(["checkout", "--quiet", "FETCH_HEAD"], dir);
  return dir;
}

/* --- reading the artwork -------------------------------------------------- */

/** Every file under a directory, as paths relative to it, sorted. */
function walk(dir, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/* --- collecting ----------------------------------------------------------- */

/** @type {Map<string, {source: object, file: string, svg: string}[]>} */
const byBase = new Map();
const stats = [];

for (const source of selected) {
  const dir = ensureClone(source);
  if (!dir) {
    console.warn(`${source.key}: not cached and --no-clone was given; skipped.`);
    stats.push({ key: source.key, taken: 0, skipped: 0, unreadable: 0 });
    continue;
  }

  const svgRoot = path.join(dir, source.svgDir);
  const files = walk(svgRoot);
  let taken = 0;
  let skipped = 0;
  let unreadable = 0;
  let unnamed = 0;

  for (const file of files) {
    const picked = source.pick(file);
    if (!picked) {
      skipped++;
      continue;
    }
    // Folded to this project's one name shape, because a `pick` returns whatever
    // the upstream file was called. Carbon namespaces two groups in
    // subdirectories, so `Q/barrier.svg` arrives as a path and becomes
    // `q-barrier`, and it ships `ccX.svg`, which becomes `ccx`. Without this a
    // name with a slash in it is a directory traversal on write.
    const name = kebabName(picked);
    if (!name) {
      unnamed++;
      continue;
    }
    // The id prefix carries the set code as well as the name, because the final
    // directory name is not known yet: two sets drawing the same base both
    // normalise under that base, and prefixing with it alone would give Phosphor's
    // `home` and Lucide's `home-lu` the same ids — the document-wide clipPath
    // collision prefixIds exists to prevent. Name plus code is unique per drawing
    // and does not depend on who wins the bare name.
    let normalised;
    try {
      normalised = normalise(
        fs.readFileSync(path.join(svgRoot, file), "utf8"),
        source.grid,
        `${name}-${source.code}`
      );
    } catch {
      normalised = null;
    }
    if (!normalised) {
      unreadable++;
      continue;
    }
    // A set that offers the same name twice (Ionicons' md-/ios- history, a
    // renamed directory) keeps the first, so a run is not order-dependent.
    const list = byBase.get(name) ?? [];
    if (list.some((entry) => entry.source.code === source.code)) {
      skipped++;
      continue;
    }
    list.push({ source, file, svg: normalised });
    byBase.set(name, list);
    taken++;
  }

  stats.push({ key: source.key, taken, skipped, unreadable, unnamed });
  console.log(
    `${source.key.padEnd(18)} ${String(taken).padStart(5)} taken` +
      `  ${String(skipped).padStart(5)} skipped` +
      (unreadable ? `  ${unreadable} unreadable` : "") +
      (unnamed ? `  ${unnamed} unnamable` : "")
  );
}

/* --- writing -------------------------------------------------------------- */

// Item 2's rule. A base drawn by one set keeps the bare name; a base drawn by
// more than one gives every copy a suffix, including the set that would have won
// the name before.
let written = 0;
let suffixed = 0;
const collisions = [];
// A suffix is only safe while no set ships an icon actually called that. If one
// does, `home-ph` could mean "Phosphor's home" or "an icon named home-ph", and
// the two would write to the same directory. Nothing in the sixteen sets does
// this today; it is reported rather than resolved because picking a winner
// silently is how one of the two drawings disappears.
const shadowed = [];
const taken = new Set(byBase.keys());

// Priority for a contested base: the earliest set in this list keeps the bare
// name, the rest take their code. Ranking by set rather than suffixing all of
// them means the default import — `cloud`, not `cloud-ph` — always exists, and
// always comes from the same set, so the plain names read as one style.
// Ionicons is last: it arrives after the other three and takes a bare name only
// where none of them draws it, so adding it renames nothing already published.
const PRIORITY = ["ph", "tb", "lu", "ion"];
const rank = (code) => {
  const i = PRIORITY.indexOf(code);
  return i === -1 ? PRIORITY.length : i;
};

for (const [base, entries] of [...byBase].sort((a, b) => a[0].localeCompare(b[0]))) {
  const contested = entries.length > 1;
  if (contested) collisions.push({ base, codes: entries.map((e) => e.source.code) });

  // Sorted so the winner is decided before any directory is written, and the
  // same input always produces the same names.
  const ordered = [...entries].sort((a, b) => rank(a.source.code) - rank(b.source.code));
  const holder = ordered[0];

  for (const entry of ordered) {
    const name = contested && entry !== holder ? `${base}-${entry.source.code}` : base;
    if (name !== base && taken.has(name)) shadowed.push(name);
    const dir = path.join(OUT_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}-regular.svg`), entry.svg);
    // Provenance travels with the artwork rather than in an index beside it, so
    // moving or deleting a directory cannot leave a stale record behind.
    fs.writeFileSync(
      path.join(dir, "source.json"),
      JSON.stringify(
        {
          source: entry.source.code,
          set: entry.source.name,
          base,
          licence: entry.source.licence,
          file: `${entry.source.repo}/${entry.source.svgDir}/${entry.file}`,
        },
        null,
        2
      ) + "\n"
    );
    written++;
    if (name !== base) suffixed++;
  }
}

const total = stats.reduce((n, s) => n + s.taken, 0);
console.log(
  `\n${written} icons written from ${stats.length} sets ` +
    `(${byBase.size} distinct names, ${suffixed} carry a source suffix).`
);
if (total !== written) console.log(`${total} taken and ${written} written; the difference is same-set duplicates.`);
console.log(`Top contested names: ${collisions
  .sort((a, b) => b.codes.length - a.codes.length)
  .slice(0, 5)
  .map((c) => `${c.base} (${c.codes.length})`)
  .join(", ")}`);
if (shadowed.length) {
  console.warn(
    `\n${shadowed.length} suffixed name(s) collide with an icon of that exact name, ` +
      `so one drawing overwrote another: ${shadowed.slice(0, 10).join(", ")}. ` +
      `Give the set a different code in scripts/sources.js.`
  );
}
console.log(`\nNext: npm run build:icons`);
