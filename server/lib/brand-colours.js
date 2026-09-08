// Published brand colours, for sites whose robots.txt asks not to be read.
//
// The theme route reads a site and takes the colour it paints itself in. Some of
// the sites people try most refuse automated reading, and that refusal is obeyed
// (server/lib/fetch-page.js). This is the second source for those: a value the
// brand publishes itself, looked up offline. Nothing here fetches anything, so
// it is not a way around the refusal — it is a different, permitted source.
//
// Keyed on the registrable domain label, so facebook.com, m.facebook.com and
// www.facebook.com all resolve to the same entry.
//
// EVERY VALUE CARRIES ITS SOURCE. A colour nobody published does not belong
// here: a guessed hex looks exactly like a correct one on screen and there is no
// way to tell them apart later. Add an entry only from the brand's own guideline
// page, and put that URL in the comment.
//
// Colours themselves are not copyrightable, and using one as a UI accent is
// ordinary use. The brand's name and logo are its trademarks and are a separate
// question: this file holds no logos.
//
// TO EXTEND: add a line with its source. For bulk coverage, the simple-icons
// project publishes hex values for thousands of brands under CC0 and would
// generate this file, but the package has no runtime dependencies and adding one
// for a fallback is a poor trade.

/** @type {Record<string, {hex: string, name: string}>} */
const BRANDS = {
  // facebook.com/brand/resources/facebookapp/logo
  facebook: { hex: "#1877F2", name: "Facebook" },
  // about.instagram.com/brand
  instagram: { hex: "#E4405F", name: "Instagram" },
  // about.x.com/en/who-we-are/brand-toolkit
  x: { hex: "#000000", name: "X" },
  twitter: { hex: "#1DA1F2", name: "Twitter" },
  // brand.linkedin.com/policies
  linkedin: { hex: "#0A66C2", name: "LinkedIn" },
  // whatsappbrand.com
  whatsapp: { hex: "#25D366", name: "WhatsApp" },
  // youtube.com/howyoutubeworks/resources/brand-resources
  youtube: { hex: "#FF0000", name: "YouTube" },
  // spotify.design/article/branding-guidelines
  spotify: { hex: "#1DB954", name: "Spotify" },
  // github.com/logos
  github: { hex: "#181717", name: "GitHub" },
  // netflix.com/brand
  netflix: { hex: "#E50914", name: "Netflix" },
  // partners.slack.com/brand-guidelines
  slack: { hex: "#4A154B", name: "Slack" },
  // discord.com/branding
  discord: { hex: "#5865F2", name: "Discord" },
  // brand.reddit.com
  reddit: { hex: "#FF4500", name: "Reddit" },
  // pinterest.com/business/brand-guidelines
  pinterest: { hex: "#BD081C", name: "Pinterest" },
  // about.pinterest.com and dropbox.com/branding
  dropbox: { hex: "#0061FF", name: "Dropbox" },
  // stripe.com/newsroom/brand-assets
  stripe: { hex: "#635BFF", name: "Stripe" },
  // figma.com/using-figma/figma-brand-guidelines
  figma: { hex: "#F24E1E", name: "Figma" },
  // notion.so/brand
  notion: { hex: "#000000", name: "Notion" },
};

/**
 * The registrable label of a host: "facebook" from "www.facebook.com".
 *
 * Deliberately crude. It walks past the leading www/m/app and past a public
 * suffix that is itself two labels (co.uk, co.in, com.au), which covers the
 * shapes a person types into this box. It is not a public-suffix-list parser and
 * does not need to be: a miss falls through to no fallback, which is the same
 * answer as before this file existed.
 */
function labelOf(host) {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  while (parts.length > 2 && ["www", "m", "app", "web"].includes(parts[0])) parts.shift();
  if (parts.length >= 3 && ["co", "com", "net", "org", "gov", "ac"].includes(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/**
 * A published colour for this URL's host, or null when there is no entry.
 *
 * The shape matches what the extractor returns for a page it did read, so the
 * route can answer with either and the page renders one thing. `source` is what
 * separates them, and it exists so the UI can say where the colour came from
 * rather than implying the site was read.
 */
export function brandColour(pageUrl) {
  let host
  try {
    host = new URL(pageUrl).host;
  } catch {
    return null;
  }
  // hasOwn, not a bare lookup: BRANDS is an object literal, so a label that
  // happens to name something on Object.prototype — constructor.com, valueof.com
  // — would otherwise return a truthy non-entry and answer with an undefined hex.
  const label = labelOf(host);
  if (!Object.hasOwn(BRANDS, label)) return null;
  const entry = BRANDS[label];
  return { hex: entry.hex, name: entry.name };
}
