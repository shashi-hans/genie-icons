// The footer line every page shares: copyright, who made it, and the visitor
// count.
//
// Built here rather than repeated in five HTML files so the year, the credit and
// the count cannot drift apart between pages. A page supplies an empty
// [data-site-footer-bar]; anything above it is that page's own.
//
// The count comes from the same /api/auth/me call the header already makes, so
// this adds no request. It stays hidden when there is no backend, rather than
// rendering "0 visitors" and looking broken.
import { loadMe } from "./header.js";
import { initAnalytics } from "./analytics.js";
import { initContactLinks } from "./contact.js";

const CREATOR = "Shashi";
const CREATOR_URL = "https://github.com/shashi-hans";

// The name the header brand uses, so the two agree. The package is `icon-genie`;
// the site is Genie Icons.
const APP_NAME = "Genie Icons";

// The upstream sets the artwork comes from, credited on every page. Names only:
// the copyright notices and full licence texts are in LICENSE and LICENSES/,
// which ship in the tarball, and a footer is not the place to restate them.
// MIT/ISC rather than MIT because Lucide is ISC and the rest are MIT.
const SOURCES = ["Tabler", "Phosphor", "Lucide", "Ionicons"];

/** Fill every [data-site-footer-bar] on the page. */
export async function initFooter() {
  // Before the early return below, so a page with no footer bar is still
  // measured.
  initAnalytics();

  const bars = document.querySelectorAll("[data-site-footer-bar]");
  if (!bars.length) return;

  // Taken from the clock rather than hardcoded: a footer that says the wrong
  // year is the classic sign of a site nobody maintains.
  const year = new Date().getFullYear();

  for (const bar of bars) {
    bar.innerHTML = `
      <div class="foot-cols">
        <div class="foot-col foot-brand">
          <span class="foot-name">${APP_NAME}</span>
          <p class="foot-blurb">A tree-shakeable React icon library, with a gallery, an AI generator and a resizer.</p>
          <span class="foot-visitors" hidden></span>
        </div>
        <div class="foot-col">
          <h2 class="foot-head">Tools</h2>
          <a href="./gallery.html">Icon Gallery</a>
          <a href="./generator.html">Icon Generator</a>
          <a href="./resizer.html">Icon Resizer</a>
          <a href="./theme.html">Icon Theme</a>
        </div>
        <div class="foot-col">
          <h2 class="foot-head">Project</h2>
          <a href="https://github.com/shashi-hans/genie-icons" rel="noopener noreferrer">GitHub</a>
          <a href="https://www.npmjs.com/package/icon-genie" rel="noopener noreferrer">npm package</a>
          <a href="./index.html">Home</a>
        </div>
        <div class="foot-col">
          <h2 class="foot-head">Legal</h2>
          <a href="./privacy.html">Privacy Policy</a>
          <a data-mailto="feedback" href="#">Send Feedback</a>
          <span class="foot-note">Icon artwork from ${SOURCES.join(", ")}</span>
        </div>
      </div>
      <div class="foot-base">
        <span>Copyright © ${year} ${APP_NAME}. All Rights Reserved</span>
        <span class="spacer"></span>
        <span>Created by <a href="${CREATOR_URL}" rel="author">${CREATOR}</a></span>
      </div>`;
  }

  // After the markup exists: the links it fills are written just above.
  initContactLinks();

  const me = await loadMe();
  const v = me.visits;
  if (!v || typeof v.visitors !== "number") return;
  const label = `${v.visitors.toLocaleString()} ${v.visitors === 1 ? "visitor" : "visitors"}`;
  for (const el of document.querySelectorAll(".foot-visitors")) {
    el.textContent = label;
    // Views are the less meaningful number of the two, so they sit in the title
    // rather than competing for the line.
    el.title = `${v.views.toLocaleString()} page views`;
    el.hidden = false;
  }
}
