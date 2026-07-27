/* Error reporting via Sentry (@sentry/browser 10.68.0, bundled locally with
 * esbuild — see SYSTEM-DESIGN.md §3.5). Captures uncaught exceptions and
 * unhandled promise rejections. No session replay, no PII, no tracing.
 *
 * DSN is a public write-only key; safe to ship in the page. Leave it empty
 * to disable reporting entirely (e.g. when working locally). */
(function () {
  var DSN = '';   // ← set to the project DSN to enable
  if (!DSN || !window.Sentry) return;
  window.Sentry.init({
    dsn: DSN,
    release: 'iso-home@' + (document.documentElement.getAttribute('data-release') || 'dev'),
    sendDefaultPii: false,
    /* report every error — traffic is small enough that sampling would
     * only hide problems */
    sampleRate: 1.0,
  });
})();
