// The sixteen icon sets this library draws artwork from, and everything the
// fetcher needs to get one SVG per icon out of each of them.
//
// One entry per set, and the `code` is what the naming rule appends to a
// colliding name: `home` drawn by three sets becomes `home` for whichever set
// scripts/fetch-sources.js ranks first, then `home-lu` and `home-bs`. Codes are
// two or three letters, unique, and permanent — renaming one renames every export
// that carries it.
//
// LICENSING IS PART OF THIS TABLE ON PURPOSE. This package redistributes the
// artwork, so a set whose licence forbids that cannot be in here whatever its
// icons look like. Two well-known sets were checked and excluded:
//
//   Remix Icon  Remix Icon License v1.0 (January 2026) clause 3.1 forbids
//               packaging the icons "as an independent icon pack, icon library,
//               or icon font". That is what this package is.
//   css.gg      From version 2.1.2 the licence is non-commercial, requires
//               attribution, and forbids derivative works.
//
// Boxicons was dropped for a different reason: the repository no longer ships
// individual SVG files at all, only a TypeScript component package.
//
// `grid` is the set's own viewBox edge. Artwork is normalised from it onto the
// 256 grid every other icon in this library uses, so a 16-unit Bootstrap icon
// does not paint in the top-left sixteenth of the cell.

/**
 * @typedef {object} Source
 * @property {string} key       directory name under the fetch cache
 * @property {string} code      suffix appended to a colliding name
 * @property {string} name      how the set is credited in the README and LICENSE
 * @property {string} repo      GitHub "owner/name"
 * @property {string} licence   SPDX id, or the licence file's own title
 * @property {string} svgDir    path inside the repo holding the SVGs
 * @property {string} [sparse]  sparse-checkout pattern, when `/svgDir/*` is too
 *   broad to be worth downloading. Gitignore-style, so `*` does not cross a `/`.
 * @property {number} grid      the set's viewBox edge, in its own units
 * @property {(file: string) => string|null} pick
 *   The icon name this file should be imported as, or null to skip it. This is
 *   where a set's size and weight variants are narrowed to the one wanted.
 */

/** Strip ".svg" and nothing else. */
const stem = (file) => file.replace(/\.svg$/i, "");

/** Take a file only when it is an SVG, under the name it already has. */
const asIs = (file) => (file.endsWith(".svg") ? stem(file) : null);

/** @type {Source[]} */
export const SOURCES = [
  // --- the eight already in raw-svgs/, now imported with their provenance ---
  {
    key: "phosphor",
    code: "ph",
    name: "Phosphor",
    repo: "phosphor-icons/core",
    licence: "MIT",
    svgDir: "assets/regular",
    grid: 256,
    pick: asIs,
  },
  {
    key: "lucide",
    code: "lu",
    name: "Lucide",
    repo: "lucide-icons/lucide",
    licence: "ISC",
    svgDir: "icons",
    grid: 24,
    // The repo keeps a .json of metadata beside every .svg.
    pick: asIs,
  },
  {
    key: "feather",
    code: "fe",
    name: "Feather",
    repo: "feathericons/feather",
    licence: "MIT",
    svgDir: "icons",
    grid: 24,
    pick: asIs,
  },
  {
    key: "tabler",
    code: "tb",
    name: "Tabler",
    repo: "tabler/tabler-icons",
    licence: "MIT",
    svgDir: "icons/outline",
    grid: 24,
    pick: asIs,
  },
  {
    key: "heroicons",
    code: "hi",
    name: "Heroicons",
    repo: "tailwindlabs/heroicons",
    licence: "MIT",
    svgDir: "optimized/24/outline",
    grid: 24,
    pick: asIs,
  },
  {
    key: "iconoir",
    code: "io",
    name: "Iconoir",
    repo: "iconoir-icons/iconoir",
    licence: "MIT",
    svgDir: "icons/regular",
    grid: 24,
    pick: asIs,
  },
  {
    key: "material-symbols",
    code: "ms",
    name: "Material Symbols",
    repo: "google/material-design-icons",
    licence: "Apache-2.0",
    svgDir: "symbols/web",
    // Narrowed past the default `/symbols/web/*`, which would check out every
    // icon at four sizes in three styles. Only the one style and size this
    // imports is materialised.
    sparse: "/symbols/web/*/materialsymbolsoutlined/*_24px.svg",
    grid: 24,
    // Laid out as symbols/web/<name>/materialsymbolsoutlined/<name>_24px.svg, so
    // the walker below hands this a path rather than a bare filename.
    //
    // The filename has to equal the directory name exactly. Beside every icon sit
    // its axis variants — abc_fill1_24px.svg, abc_grad200_24px.svg — which are
    // the same drawing at a different optical weight, and a looser match would
    // import all of them under the one name.
    pick: (file) => {
      const m = /^([^/]+)\/materialsymbolsoutlined\/([^/]+)_24px\.svg$/.exec(file);
      if (!m || m[1] !== m[2]) return null;
      return m[1].replace(/_/g, "-");
    },
  },
  {
    key: "ionicons",
    code: "ion",
    name: "Ionicons",
    repo: "ionic-team/ionicons",
    licence: "MIT",
    svgDir: "src/svg",
    grid: 512,
    // Every icon ships as <name>.svg plus -outline and -sharp variants. The bare
    // name is the filled one; the outline is the closest match to the rest of
    // this library, so that is the one taken and the suffix is dropped.
    pick: (file) => {
      if (!file.endsWith("-outline.svg")) return null;
      return stem(file).replace(/-outline$/, "");
    },
  },

  // --- the eight added here ---
  {
    key: "bootstrap",
    code: "bs",
    name: "Bootstrap Icons",
    repo: "twbs/icons",
    licence: "MIT",
    svgDir: "icons",
    grid: 16,
    // Each icon has an outline and a `-fill` twin. The outline matches the rest
    // of this library, so the fills are skipped rather than imported as a weight
    // no other set would have.
    pick: (file) => (file.endsWith("-fill.svg") ? null : asIs(file)),
  },
  {
    key: "octicons",
    code: "oc",
    name: "Octicons",
    repo: "primer/octicons",
    licence: "MIT",
    svgDir: "icons",
    grid: 24,
    // Sizes are baked into the filename: alert-16.svg, alert-24.svg. 24 is the
    // one kept, and the size comes off the name. The 22 `-fill-24` files are the
    // filled cut of an icon that also ships an outline, so they are skipped for
    // the same reason Bootstrap's fills are: one cut per icon, and the outline is
    // the one the rest of this library matches.
    pick: (file) => {
      const m = /^(.+)-24\.svg$/.exec(file);
      if (!m || m[1].endsWith("-fill")) return null;
      return m[1];
    },
  },
  {
    key: "carbon",
    code: "cb",
    name: "Carbon",
    repo: "carbon-design-system/carbon",
    licence: "Apache-2.0",
    svgDir: "packages/icons/src/svg/32",
    grid: 32,
    // Carbon separates words with a double dash: chevron--down. Collapsed to one,
    // so the name reads like every other icon here.
    pick: (file) => (file.endsWith(".svg") ? stem(file).replace(/-{2,}/g, "-") : null),
  },
  {
    key: "radix",
    code: "rx",
    name: "Radix Icons",
    repo: "radix-ui/icons",
    licence: "MIT",
    svgDir: "packages/radix-icons/icons",
    grid: 15,
    pick: asIs,
  },
  {
    key: "akar",
    code: "ak",
    name: "Akar Icons",
    repo: "artcoholic/akar-icons",
    licence: "MIT",
    svgDir: "src/svg",
    grid: 24,
    pick: asIs,
  },
  {
    key: "pixelarticons",
    code: "px",
    name: "Pixelarticons",
    repo: "halfmage/pixelarticons",
    licence: "MIT",
    svgDir: "svg",
    grid: 24,
    // `-sharp` is a second cut of the same drawing; one per icon is the rule.
    pick: (file) => (file.endsWith("-sharp.svg") ? null : asIs(file)),
  },
  {
    key: "teenyicons",
    code: "tn",
    name: "Teenyicons",
    repo: "teenyicons/teenyicons",
    licence: "MIT",
    svgDir: "src/outline",
    grid: 15,
    pick: asIs,
  },
  {
    key: "eva",
    code: "ev",
    name: "Eva Icons",
    repo: "akveo/eva-icons",
    licence: "MIT",
    svgDir: "package/icons/outline/svg",
    grid: 24,
    // Files are named activity-outline.svg. The whole directory is the outline
    // cut, so the suffix says nothing and comes off.
    pick: (file) => {
      if (!file.endsWith("-outline.svg")) return null;
      return stem(file).replace(/-outline$/, "");
    },
  },
];

/** A set by its code, for reading provenance back off an icon name. */
export const BY_CODE = new Map(SOURCES.map((s) => [s.code, s]));

/** A set by its key, for the fetcher and the licence writer. */
export const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

// A code is appended to icon names and so is part of the public export surface.
// A duplicate would silently merge two sets under one suffix, so it fails here
// rather than at import time.
{
  const seen = new Set();
  for (const s of SOURCES) {
    if (seen.has(s.code)) throw new Error(`Duplicate source code "${s.code}" in SOURCES.`);
    seen.add(s.code);
  }
}
