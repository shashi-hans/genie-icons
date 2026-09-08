// Turning one upstream SVG file into inner markup on this library's 256 grid.
//
// Its own module, with no side effects, because scripts/fetch-sources.js does its
// work at import time and this has to be testable and reusable without setting
// sixteen clones going.
//
// The wrapper every consumer here renders into is `viewBox="0 0 256 256"`: the
// React components, /api/svg, and the pages that inline markup with innerHTML.
// The sixteen sets draw on 15, 16, 24, 32, 256 and 512, so artwork has to be
// moved onto the 256 grid or a Bootstrap icon paints in the top-left sixteenth
// of the cell.

/** The `viewBox` an SVG declares, as [minX, minY, width, height], or null. */
export function viewBoxOf(svg) {
  const m = /\sviewBox\s*=\s*["']([^"']+)["']/i.exec(svg);
  if (!m) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

// The presentation attributes a root <svg> sets for its children to inherit.
// Dropping these was a bug worth spelling out: eight of the sixteen sets put the
// icon's whole appearance here rather than on the paths. Lucide, Feather and
// Tabler declare `fill="none" stroke="currentColor" stroke-width="2"` on the
// root and nothing on the path, so a Lucide star with the root discarded
// inherits `fill="currentColor"` from this library's wrapper and renders as a
// solid black star instead of an outline. Radix, Akar and Teenyicons set
// `fill="none"`; Heroicons and Iconoir set a stroke width.
const INHERITABLE = [
  "fill", "fill-rule", "fill-opacity",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-opacity",
  "clip-rule", "opacity", "color",
];

/**
 * The root `<svg>`'s inheritable presentation attributes, ready to re-emit.
 *
 * Both quote styles are matched. Single quotes are valid XML and a set that uses
 * them would otherwise lose its whole root presentation here — a `fill='none'`
 * outline then inherits `currentColor` from this library's wrapper and renders as
 * a solid shape.
 */
export function rootPresentation(svg) {
  const open = /<svg([^>]*)>/i.exec(svg)?.[1];
  if (!open) return "";
  const out = [];
  for (const prop of INHERITABLE) {
    const m = new RegExp(`\\s${prop}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(open);
    if (!m) continue;
    let value = (m[1] ?? m[2]).trim();
    if (!value) continue;
    if (prop === "stroke-width" || prop === "stroke-miterlimit") value = value.replace(/px$/i, "");
    if (prop === "fill" || prop === "stroke" || prop === "color") value = toCurrent(value);
    out.push(`${prop}="${value.replace(/"/g, "&quot;")}"`);
  }
  return out.join(" ");
}

/** Everything between `<svg …>` and `</svg>`, or null when there is no element. */
export function innerOf(svg) {
  const open = svg.search(/<svg[\s>]/i);
  if (open === -1) return null;
  const gt = svg.indexOf(">", open);
  const close = svg.lastIndexOf("</svg>");
  if (gt === -1 || close === -1 || close < gt) return null;
  return svg.slice(gt + 1, close).trim();
}

// Markup with no place in a fragment pasted inside another <svg>.
//
// <style> and <script> are dropped rather than rewritten. A set that needs a
// stylesheet to render is not artwork this pipeline can carry, and inlining its
// rules would leak them into whatever page holds the fragment: an upstream
// `.a{fill:red}` would repaint anything else on that page matching `.a`. The
// rest are metadata that would be inlined thousands of times over for nothing.
const STRIP_PAIRS = /<(style|script|title|desc|metadata|foreignObject)\b[^>]*>[\s\S]*?<\/\1>/gi;
const STRIP_EMPTY = /<(title|desc|metadata|foreignObject)\b[^>]*\/>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

// Editor leftovers, which several Carbon icons carry because they were exported
// from Illustrator with its private data still in them: a <switch> whose first
// branch is a <foreignObject> holding <i:aipgfRef> and kilobytes of base64 in
// CDATA. Left in, that reaches the generated component as invalid JSX, which is
// how it was found — five icons failed `tsc`.
//
// <foreignObject> goes with the pairs above, because everything inside it is
// the editor's, not artwork. Then:
const CDATA = /<!\[CDATA\[[\s\S]*?\]\]>/g;
// Any element in a namespace the SVG renderer does not know. `<i:aipgfRef>` and
// friends, paired or self-closing, with whatever they contain.
const NS_ELEMENTS = /<([a-z][\w.-]*):([\w.-]+)\b[^>]*(?:\/>|>[\s\S]*?<\/\1:\2>)/gi;
// <switch> picks the first branch it can render. With the editor's branch gone
// the remaining child is the artwork, so the wrapper has nothing left to choose
// and is unwrapped rather than kept.
const SWITCH_TAGS = /<\/?switch\b[^>]*>/gi;
// A namespaced attribute, which React does not pass through and JSX may not even
// parse. `xlink:href` is kept: it is how a <use> element references a symbol and
// real artwork depends on it.
const NS_ATTRS = /\s(?!xlink:href)[a-z][\w.-]*:[\w.-]+\s*=\s*("[^"]*"|'[^']*')/gi;

// `class` is invalid in JSX, which wants className, and with <style> stripped it
// has nothing left to bind to anyway. `data-name` is Illustrator's export
// metadata, valid but pure weight: 2,952 of them across the sixteen sets.
const DEAD_ATTRS = /\s(?:class|data-name)\s*=\s*("[^"]*"|'[^']*')/gi;

// A `style` attribute, which in JSX must be an object and not a string, so it is
// a type error rather than a rendering quirk. 383 icons carry one, nearly all
// Ionicons, and they hold real appearance: fill:none, the stroke width, the line
// joins. They are rewritten as the equivalent presentation attributes.
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

// The properties worth carrying across. Anything else in a style string is
// either irrelevant to a monochrome icon or unsafe to hoist onto the element.
const STYLE_PROPS = new Set([
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-opacity",
  "opacity", "clip-rule",
]);

/**
 * A fixed black turned into `currentColor`, so an icon follows the theme.
 *
 * The sixteen sets are not consistent about this: 5,328 paths already say
 * currentColor, but 1,359 say `black` and 114 say `#000`, and those render black
 * on a dark background whatever the page asks for. This library is monochrome
 * and every consumer drives it with `color`, so a literal black is a mistake in
 * the source rather than a choice worth preserving.
 *
 * `white` is deliberately left alone. It is used as a knockout, punching a hole
 * in a filled shape, and turning it into currentColor would fill the hole in.
 * There are 37 of those and they are reported by the fetcher rather than guessed
 * at here.
 */
/** A hex or `black` colour's brightness on 0..1, or null when not a flat colour. */
function brightness(value) {
  const v = value.trim().toLowerCase();
  if (v === "black") return 0;
  if (v === "white") return 1;
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1];
  if (!hex) {
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
    if (!rgb) return null;
    const [r, g, b] = rgb.slice(1).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Anything this dark is the icon's ink, whatever the set called it. The sixteen
// sets write it as `black`, `#000`, `#000000`, and — Eva for all 244 of its
// icons — `#231f20`, plus a handful of `#090909` and `#171717`. Fixed ink
// renders the same in dark mode as in light, which is wrong for a monochrome
// library every consumer drives with `color`.
const INK_MAX_BRIGHTNESS = 0.25;

/**
 * A fixed dark colour turned into `currentColor`, so an icon follows the theme.
 *
 * White and near-white are deliberately left: they are knockouts punching holes
 * in a filled shape, and turning one into currentColor fills the hole in.
 */
function toCurrent(value) {
  const b = brightness(value);
  return b !== null && b <= INK_MAX_BRIGHTNESS ? "currentColor" : value;
}

/** Rewrite a `style="a:b;c:d"` string as presentation attributes. */
function styleToAttrs(style) {
  const out = [];
  for (const part of style.split(";")) {
    const at = part.indexOf(":");
    if (at === -1) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    let value = part.slice(at + 1).trim();
    if (!prop || !value || !STYLE_PROPS.has(prop)) continue;
    // `stroke-width:32px` is valid CSS and invalid as an SVG attribute value.
    if (prop === "stroke-width" || prop === "stroke-miterlimit") value = value.replace(/px$/i, "");
    if (prop === "fill" || prop === "stroke") value = toCurrent(value);
    out.push(`${prop}="${value.replace(/"/g, "&quot;")}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

// A literal ink colour on the attributes themselves, once the style strings and
// the stylesheet are gone. Both quote styles, so `fill='#000'` is folded to
// currentColor like `fill="#000"`.
const COLOR_ATTRS = /\s(fill|stroke)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Fold a `<style>` block into the elements it targets, before the block is
 * stripped.
 *
 * This is not a nicety. 2,984 icons — every Carbon icon and every Eva one —
 * carry `<defs><style>.cls-1{fill:none}</style></defs>` and a full-size
 * `<rect class="cls-1">` behind the drawing. Strip the stylesheet and the class
 * without resolving them and that rect loses its `fill:none`, inherits
 * `currentColor` from the wrapper, and paints a solid square over the icon. That
 * is exactly what happened: `star-cb` and `star-ev` rendered as black squares.
 *
 * Only single-class selectors are handled, which is all these sets use. A rule
 * this cannot parse is dropped with the stylesheet, so an icon relying on
 * something more elaborate is caught by the "nothing that draws" check rather
 * than shipped looking wrong.
 *
 * CSS beats presentation attributes in SVG, so a declaration replaces an
 * attribute of the same name rather than deferring to it.
 */
function inlineStyleBlocks(inner) {
  const blocks = [...inner.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (!blocks.length) return inner;

  /** @type {Map<string, Record<string,string>>} class -> declarations */
  const byClass = new Map();
  for (const [, css] of blocks) {
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decls = {};
      for (const part of body.split(";")) {
        const at = part.indexOf(":");
        if (at === -1) continue;
        const prop = part.slice(0, at).trim().toLowerCase();
        const value = part.slice(at + 1).trim();
        if (prop && value && STYLE_PROPS.has(prop)) decls[prop] = value;
      }
      if (!Object.keys(decls).length) continue;
      for (const selector of selectors.split(",")) {
        const m = /^\s*\.([\w-]+)\s*$/.exec(selector);
        if (m) byClass.set(m[1], { ...(byClass.get(m[1]) ?? {}), ...decls });
      }
    }
  }
  if (!byClass.size) return inner;

  // Rewrite every element that names one of those classes.
  return inner.replace(/<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g, (whole, tag, attrs, close) => {
    const classMatch = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
    const classes = classMatch ? (classMatch[1] ?? classMatch[2]) : null;
    if (!classes) return whole;
    let decls = {};
    for (const cls of classes.trim().split(/\s+/)) {
      const found = byClass.get(cls);
      if (found) decls = { ...decls, ...found };
    }
    const names = Object.keys(decls);
    if (!names.length) return whole;
    // Drop any attribute the stylesheet also sets, then append the resolved set.
    let rest = attrs;
    for (const prop of names) {
      rest = rest.replace(new RegExp(`\\s${prop}\\s*=\\s*("[^"]*"|'[^']*')`, "gi"), "");
    }
    const resolved = names
      .map((prop) => {
        let value = decls[prop];
        if (prop === "stroke-width" || prop === "stroke-miterlimit") value = value.replace(/px$/i, "");
        if (prop === "fill" || prop === "stroke") value = toCurrent(value);
        return `${prop}="${value.replace(/"/g, "&quot;")}"`;
      })
      .join(" ");
    return `<${tag}${rest} ${resolved}${close}>`;
  });
}

/**
 * Make an icon's ids unique to it.
 *
 * 36 icons use a `clipPath` and 6 a `mask`, referenced by id. The gallery inlines
 * thousands of icons into one document, and an id is document-wide: two icons
 * both carrying `id="a"` means the second one's `url(#a)` resolves to the
 * first's clip path, so it renders clipped by the wrong shape. SVGO's cleanupIds
 * makes this worse rather than better, because minifying ids is what drives
 * every icon towards the same short names.
 *
 * Unreferenced ids are left for SVGO to remove; this only has to make the
 * referenced ones distinct.
 */
function prefixIds(body, prefix) {
  if (!prefix || !/\sid\s*=/.test(body)) return body;
  const tag = (id) => `${prefix}-${id}`;
  // Both quote styles on the definitions and the references. The `url(#x)` form
  // carries no quotes of its own and is always rewritten, so an `id='a'` left
  // untouched would leave `url(#icon-a)` pointing at nothing — the clip path
  // gone and the shape drawn unclipped.
  return body
    .replace(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, dq, sq) => ` id="${tag(dq ?? sq)}"`)
    // url(#x) covers clip-path, mask, fill and stroke references alike.
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_, id) => `url(#${tag(id)})`)
    // <use> and friends reference by fragment.
    .replace(
      /(xlink:href|href)\s*=\s*(?:"#([^"]*)"|'#([^']*)')/g,
      (_, attr, dq, sq) => `${attr}="#${tag(dq ?? sq)}"`
    );
}

/**
 * One upstream SVG as a whole `<svg viewBox="0 0 256 256">` document, or null
 * when the file holds nothing renderable.
 *
 * Scaled with a `<g transform>` rather than by rewriting coordinates. That is
 * exact for every path command, arc flags and all, where rescaling the numbers
 * by hand is not, and it carries a viewBox that does not start at `0 0` for
 * free. The cost is one wrapping element per icon, which SVGO then folds into
 * the path data anyway.
 *
 * A non-square viewBox is scaled on its longer edge and centred on the other,
 * so the drawing keeps its proportions instead of being stretched to fit.
 *
 * @param {string} svg    the upstream file's contents
 * @param {number} grid   the set's nominal viewBox edge, used only when the file
 *                        declares no viewBox
 * @param {string} [name] the icon's name, used to keep its ids to itself
 */
export function normalise(svg, grid, name) {
  const inner = innerOf(svg);
  if (inner === null) return null;

  // Order matters. CDATA first, because its base64 can contain anything that
  // looks like a tag. Then the paired elements, so <foreignObject> takes its
  // namespaced children with it and NS_ELEMENTS has less to do. Then the
  // leftovers, and only then the <switch> wrapper, which is meaningless once its
  // alternative branches are gone.
  const body = inlineStyleBlocks(inner.replace(COMMENTS, ""))
    .replace(CDATA, "")
    .replace(STRIP_PAIRS, "")
    .replace(STRIP_EMPTY, "")
    .replace(NS_ELEMENTS, "")
    .replace(SWITCH_TAGS, "")
    .replace(NS_ATTRS, "")
    .replace(DEAD_ATTRS, "")
    // Before the attribute pass below, so a colour that arrived inside a style
    // string is normalised by the same rule as one that arrived as an attribute.
    .replace(STYLE_ATTR, (_, dq, sq) => styleToAttrs(dq ?? sq))
    .replace(COLOR_ATTRS, (_, prop, dq, sq) => ` ${prop}="${toCurrent(dq ?? sq)}"`)
    .trim();
  const scoped = prefixIds(body, name);
  if (!scoped) return null;
  // Nothing that draws survived, so there is no icon here. Guards against a file
  // that was entirely editor scaffolding.
  if (!/<(path|circle|rect|ellipse|line|polyline|polygon|use|g)\b/i.test(scoped)) return null;

  const box = viewBoxOf(svg) ?? [0, 0, grid, grid];
  const [minX, minY, width, height] = box;
  if (!(width > 0) || !(height > 0)) return null;

  const scale = 256 / Math.max(width, height);
  const dx = (256 - width * scale) / 2;
  const dy = (256 - height * scale) / 2;

  // Trailing zeros off, so `scale(16)` does not read `scale(16.0000)`.
  const round = (n) => String(Number(n.toFixed(4)));
  const parts = [];
  if (dx || dy) parts.push(`translate(${round(dx)} ${round(dy)})`);
  if (scale !== 1) parts.push(`scale(${round(scale)})`);
  if (minX || minY) parts.push(`translate(${round(-minX)} ${round(-minY)})`);

  // One <g> carries both the scaling and whatever the root <svg> was setting for
  // its children, so the artwork keeps the appearance it had upstream. The
  // scaling applies to stroke-width too, which is what it should do: Iconoir's
  // 1.5 on a 24 grid becomes 16 on the 256 grid, which is exactly the regular
  // width the centerline icons stroke at (scripts/derive-weights.js).
  const presentation = rootPresentation(svg);
  const gAttrs = [
    parts.length ? `transform="${parts.join(" ")}"` : "",
    presentation,
  ]
    .filter(Boolean)
    .join(" ");
  const wrapped = gAttrs ? `<g ${gAttrs}>${scoped}</g>` : scoped;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${wrapped}</svg>`;
}
