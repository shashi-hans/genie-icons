// Google Analytics 4, loaded on every page.
//
// NO CONSENT GATE. This is a deliberate decision taken by the site's owner, not
// an oversight, and it is the one thing to know before editing this file.
//
// The DPDP Act 2023 requires consent to process personal data and has no
// legitimate-interest fallback of the kind GDPR provides. GA sends the visitor's
// IP address and a client identifier to Google, which is such processing. So
// running it ungated is a risk accepted by whoever owns the privacy notice, and
// the site's notice needs to name Google as a processor either way.
//
// If that decision is ever revisited, the gate is the whole change: hold the
// load() call until the visitor agrees, and remember the answer. Everything else
// here stays as it is.
//
// This measures what the site's own counters cannot — sessions, engagement,
// referrers and the generator funnel. The counters remain the source of truth
// for visitors, views, per-icon copies and downloads, and generator usage: those
// stay in ap-south-1, key on the guest cookie, and read no IP. GA is additive,
// and switching it off changes none of them.
//
// TO ENABLE: set MEASUREMENT_ID to the "G-XXXXXXXXXX" of the GA4 property.
// Empty means the module is inert — no script, no cookie, no request — which is
// how it ships so a fork cannot report into someone else's property.
//
// The ID is not a secret. It identifies the property to Google and is visible in
// any page that loads GA, so it is a constant here rather than something the
// server injects.
const MEASUREMENT_ID = "G-7WP6EP719G";

let loaded = false;

/**
 * Load gtag.js and configure it.
 *
 * The privacy options go in the same call that starts collection, not after: a
 * config sent late still leaves the first page_view already gone with the
 * defaults.
 *
 *   allow_google_signals              off, so this is not joined to an ad profile
 *   allow_ad_personalization_signals  off, for the same reason
 *
 * Both keep this to measurement rather than advertising. They do not move the
 * processing into India and they are not a substitute for the consent this
 * deliberately does not ask for.
 *
 * anonymize_ip is not sent: GA4 has no such setting. It drops the last octet of
 * every address before storage on its own, and the parameter is a Universal
 * Analytics field that GA4 ignores. The address still reaches Google's servers
 * first, which is the part the privacy notice has to say out loud.
 */
function load() {
  if (loaded || !MEASUREMENT_ID) return;
  loaded = true;

  window.dataLayer = window.dataLayer || [];
  // The real gtag: a plain function pushing `arguments` onto dataLayer, which is
  // what Google's own snippet does. An arrow function has no `arguments`.
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  // Ad storage stays denied under Consent Mode even though analytics is not
  // gated. Nothing here is advertising, and leaving it at Google's default would
  // opt the site into more than it asked for.
  window.gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });

  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);
}

/**
 * One custom event, ignored when GA is not configured.
 *
 * Exported so the generator can mark its funnel steps — the one thing GA is here
 * for that the site's own counters cannot answer. `params` should carry no
 * personal data: an icon name is fine, a prompt someone typed is not.
 */
export function track(name, params) {
  if (!MEASUREMENT_ID || typeof window.gtag !== "function") return;
  window.gtag("event", name, params ?? {});
}

/**
 * Called once per page, from initFooter, which every page already runs.
 *
 * Returns without touching the DOM when there is no MEASUREMENT_ID, so a
 * checkout that has not configured GA loads no script at all.
 */
export function initAnalytics() {
  load();
}
