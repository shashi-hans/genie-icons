// Move the tree scripts/fetch-sources.js staged into raw-svgs/, adding only.
//
//   node scripts/merge-sources.js            report what would happen
//   node scripts/merge-sources.js --apply    do it
//
// Reports by default, because this writes tens of thousands of directories into
// a committed tree and the report is the thing worth reading first.
//
// THREE RULES, and every one of them protects what is already in raw-svgs/.
//
// 1. An icon already in raw-svgs/ is never overwritten unless a previous run of
//    this same import wrote it, which the recorded source says. 4,323 of the 4,415
//    imported icons there carry more than one distinct cut of their drawing, and
//    a set gives us one. Replacing them would trade six real drawings for one
//    and turn `weight="fill"` into the outline for each. The cost of keeping
//    them is that their provenance stays unknown: nothing recorded which of the
//    eight sets drew them, and it cannot be recovered from the artwork.
//
// 2. A staged name that collides with anything already there takes its source
//    suffix, rather than being skipped. This is what keeps the 4,053 centerline
//    icons from this project's own generator on their bare names: `heart` stays
//    the generated drawing, and Lucide's arrives as `heart-lu` even though
//    Lucide is the only set that draws it. Both are then in the catalogue, which
//    is what lets the review screen compare them.
//
// 3. Nothing is deleted. 1,257 names in raw-svgs/ are not produced by the
//    registry at all, being old bare names that are now suffixed upstream. They
//    stay, without a source.json, and read as an unknown source.
//
// The result is a catalogue that is provenance-tracked in part and not in whole,
// which is a deliberate trade: no export that this package already published
// changes, and no artwork is lost.
import fs from "node:fs";
import path from "node:path";
import { ROOT, RAW_SVGS_DIR } from "./utils.js";
import { BY_CODE } from "./sources.js";

const IN_DIR = path.join(ROOT, "raw-svgs-incoming");
const apply = process.argv.includes("--apply");

if (!fs.existsSync(IN_DIR)) {
  console.error(`No staged tree at ${IN_DIR}. Run \`npm run fetch:sources\` first.`);
  process.exit(1);
}

const existing = new Set(fs.readdirSync(RAW_SVGS_DIR));
const staged = fs.readdirSync(IN_DIR).sort();

/** What raw-svgs/ already holds under this name, for the report. */
function kindOf(name) {
  return fs.existsSync(path.join(RAW_SVGS_DIR, name, `${name}.centerline.svg`))
    ? "generated"
    : "imported";
}

/**
 * Whether the icon already at this name is one a previous run of this same
 * import wrote, which is the only case where overwriting is right.
 *
 * An icon with no source.json is never ours: that is this project's own
 * generated artwork, or one of the 8,467 imported before provenance existed.
 */
function sameSource(name, code, base) {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(RAW_SVGS_DIR, name, "source.json"), "utf8")
    );
    return meta.source === code && (meta.base ?? name) === base;
  } catch {
    return false;
  }
}

const plan = [];
const conflicts = [];
// Names claimed during this run, so two staged icons cannot both be redirected
// onto one target.
const claimed = new Set();

for (const name of staged) {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(IN_DIR, name, "source.json"), "utf8"));
  } catch {
    conflicts.push({ name, why: "no readable source.json" });
    continue;
  }

  const base = meta.base ?? name;
  const code = meta.source;
  if (!BY_CODE.has(code)) {
    conflicts.push({ name, why: `unknown source code "${code}"` });
    continue;
  }

  // The name it wants, then the name rule 2 gives it. Deduped, because a name
  // contested upstream is already `base-code`.
  const suffixed = `${base}-${code}`;
  const candidates = suffixed === name ? [name] : [name, suffixed];

  let target = null;
  let reason = "";
  for (const candidate of candidates) {
    // Claimed earlier in this same run, so it is another staged icon's.
    if (claimed.has(candidate)) continue;
    if (!existing.has(candidate)) {
      target = candidate;
      reason = candidate === name ? "new name" : `${name} exists (${kindOf(name)}), suffixed`;
      break;
    }
    // Written by a previous run of this same import, so it is ours to correct.
    // This is what makes the import idempotent and able to fix its own output:
    // five Carbon icons shipped with Illustrator scaffolding that the normaliser
    // now strips, and they would otherwise keep the markup of the run that first
    // wrote them. Ours is decided by the recorded source, never by the name.
    if (sameSource(candidate, code, base)) {
      target = candidate;
      reason = "refresh, same source";
      break;
    }
  }

  if (!target) {
    conflicts.push({
      name,
      why:
        `raw-svgs/${name} exists (${kindOf(name)})` +
        (candidates.length > 1 ? ` and ${suffixed} is taken by something else` : ""),
    });
    continue;
  }

  claimed.add(target);
  plan.push({ from: name, target, code, base, reason });
}

/* --- report --------------------------------------------------------------- */

// A refresh rewrites a directory that is already there; only the rest grow the
// tree. The two overlap with "suffixed", which is about the name rather than
// about whether the directory is new, so they are counted separately.
const refreshed = plan.filter((p) => p.reason === "refresh, same source");
const added = plan.filter((p) => p.reason !== "refresh, same source");
const suffixed = plan.filter((p) => p.from !== p.target);
const bySource = new Map();
for (const p of plan) bySource.set(p.code, (bySource.get(p.code) ?? 0) + 1);

console.log(`staged            ${staged.length}`);
console.log(`already in tree   ${existing.size}`);
console.log(`to write          ${plan.length}`);
console.log(`  new directories         ${added.length}`);
console.log(`  refreshed in place      ${refreshed.length}  (this import's own earlier output)`);
console.log(`  carrying a suffix       ${suffixed.length}  (rule 2; overlaps the two above)`);
console.log(`untouched         ${existing.size - refreshed.length}  (rule 1)`);
console.log(`conflicts         ${conflicts.length}`);
console.log(`result            ${existing.size + added.length} icons in raw-svgs/`);
console.log(
  `\nper set: ${[...bySource]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}=${n}`)
    .join("  ")}`
);
if (suffixed.length) {
  console.log(`\nfirst few carrying a suffix:`);
  for (const p of suffixed.slice(0, 6)) console.log(`  ${p.from} -> ${p.target}   (${p.reason})`);
}
if (conflicts.length) {
  console.log(`\nconflicts, not added:`);
  for (const c of conflicts.slice(0, 10)) console.log(`  ${c.name}: ${c.why}`);
  if (conflicts.length > 10) console.log(`  ...and ${conflicts.length - 10} more`);
}

if (!apply) {
  console.log(`\nReport only. Re-run with --apply to write.`);
  process.exit(0);
}

/* --- apply ---------------------------------------------------------------- */

let written = 0;
for (const p of plan) {
  const from = path.join(IN_DIR, p.from);
  const to = path.join(RAW_SVGS_DIR, p.target);
  fs.mkdirSync(to, { recursive: true });
  // The artwork is renamed to match its directory, because generate-components
  // finds a weight file by `<name>-<weight>.svg`.
  fs.copyFileSync(path.join(from, `${p.from}-regular.svg`), path.join(to, `${p.target}-regular.svg`));
  const meta = JSON.parse(fs.readFileSync(path.join(from, "source.json"), "utf8"));
  fs.writeFileSync(path.join(to, "source.json"), JSON.stringify(meta, null, 2) + "\n");
  written++;
}

console.log(
  `\n${written} written to raw-svgs/ (${added.length} new, ${refreshed.length} refreshed). ` +
    `Next: npm run build:icons`
);
