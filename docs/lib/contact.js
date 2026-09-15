// The site's two contact addresses, and the mailto links that reach them.
//
// A mail arriving at either of these should say which application it is about
// and where the person was, without them having to describe it. A bare mailto:
// cannot do that — the page it was clicked from is only known at runtime — so
// the links are built here and written into the markup on load.
//
// WHAT IS PREFILLED, AND WHY EACH PIECE
//
//   application   these inboxes may serve more than one thing; the name settles it
//   page          which screen they were on when they wrote
//   date          when, in their own words, independent of mail headers
//   reference     their guest id, the only thing that can find their icons and
//                 history. The privacy page asks for it in words; this saves
//                 them hunting for it.
//   browser       the user agent, for a bug that only happens somewhere
//
// It is a draft in their own mail client. They can read every line and delete
// any of it before sending, which is the difference between this and the site
// reporting on them.
import { loadMe } from "./header.js";

export const GRIEVANCE_EMAIL = "grievance.genie@gmail.com";
export const FEEDBACK_EMAIL = "feedback.genie09@gmail.com";

const APP_NAME = "Genie Icons";

// Resolved once per page by initContactLinks, and read by every link built
// afterwards. Empty until then, which only costs the Reference line.
let guestId = "";

/**
 * The context block, as plain lines under a separator.
 *
 * Below the signature line so the person's own words come first and this reads
 * as an attachment to the mail rather than the start of it.
 */
function contextLines() {
  const lines = [
    `Application: ${APP_NAME}`,
    `Page: ${location.href}`,
    `Date: ${new Date().toISOString()}`,
  ];
  // Absent when the API is unreachable or the cookie was cleared, and the mail
  // is still worth sending without it.
  if (guestId) lines.push(`Reference: ${guestId}`);
  lines.push(`Browser: ${navigator.userAgent}`);
  return lines;
}

/** A mailto: URL for `address`, with the subject and the context prefilled. */
export function mailtoHref(address, subject, intro = "") {
  const body = [
    intro,
    "",
    "",
    "--- please keep the lines below, they help us find your data ---",
    ...contextLines(),
  ].join("\r\n");
  // encodeURIComponent, not encodeURI: a subject or body can hold & and #,
  // which would otherwise end the parameter early and truncate the mail.
  return (
    `mailto:${address}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

/**
 * Fill every [data-mailto] link on the page.
 *
 * The element carries `data-mailto="grievance|feedback"` and an optional
 * `data-mailto-subject`. The href is set here rather than in the markup so it
 * cannot go stale, and so the address is written in exactly one place.
 *
 * The guest id is fetched once, from the same /api/auth/me the header already
 * calls, so this adds no request. The links work before it resolves and are
 * rewritten with the reference when it does.
 */
export async function initContactLinks() {
  const links = document.querySelectorAll("[data-mailto]");
  if (!links.length) return;

  const fill = (el) => {
    const address = el.dataset.mailto === "grievance" ? GRIEVANCE_EMAIL : FEEDBACK_EMAIL;
    const subject =
      el.dataset.mailtoSubject ||
      (el.dataset.mailto === "grievance" ? `${APP_NAME}: grievance` : `${APP_NAME}: feedback`);
    el.href = mailtoHref(address, subject, el.dataset.mailtoIntro ?? "");
    // The address itself as the label, where the markup left it empty.
    if (el.dataset.mailtoLabel === "address") el.textContent = address;
  };

  for (const el of links) {
    fill(el);
    // Rebuilt on the way out, so the Date line says when the mail was started
    // rather than when the tab was opened. The href is set before the browser
    // follows it, so this needs no preventDefault.
    el.addEventListener("click", () => fill(el));
  }

  try {
    const me = await loadMe();
    if (me?.guestId) {
      guestId = me.guestId;
      for (const el of links) fill(el);
    }
  } catch {
    // No API, so no reference line. The links still work.
  }
}
