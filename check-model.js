/*  check-model.js — run unit-model.js headless and report every plan.
 *
 *  Runs on JavaScriptCore, which ships with macOS — no install, no Node:
 *
 *      ./check-model.sh                       # every plan
 *      jsc -e 'PLAN="hazel"' check-model.js   # just one
 *
 *  This is the cheap smoke test for the whole file: jsc executes the same
 *  script the page does, so any ReferenceError is fatal here even when the
 *  browser preview swallows it. It also prints the areas, the room schedule
 *  and the route widths, which is how a plan gets checked without a browser.
 *
 *  initGL() bails when getContext('webgl') returns null, so the 2D path runs
 *  and no GL stub is needed.
 */
var noop = function () {};
var NOOP_RE = /^(add|remove)EventListener$|^(setAttribute|append|appendChild|insertBefore|removeChild|click|focus|blur|remove|setPointerCapture|releasePointerCapture|preventDefault|scrollIntoView)$/;

var CTX = new Proxy({}, {
  get: function (t, k) { return k in t ? t[k] : noop; },
  set: function (t, k, v) { t[k] = v; return true; },
});

function makeEl(tag) {
  var store = {
    tagName: String(tag || 'div').toUpperCase(), style: { cssText: '' }, dataset: {}, value: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
  };
  store.parentNode = null;
  return new Proxy(store, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (k === 'querySelectorAll') return function () { return []; };
      if (k === 'querySelector')    return function () { return makeEl(); };
      /* null for webgl is the point: initGL() takes its no-GL branch */
      if (k === 'getContext')       return function (kind) { return kind === '2d' ? CTX : null; };
      if (k === 'getBoundingClientRect')
        return function () { return { width: 960, height: 680, left: 0, top: 0, right: 960, bottom: 680 }; };
      if (k === 'getAttribute') return function () { return null; };
      if (k === 'closest')      return function () { return null; };
      if (typeof k === 'string' && NOOP_RE.test(k)) return noop;
      return undefined;
    },
    set: function (t, k, v) { t[k] = v; return true; },
  });
}

var mem = {};
globalThis.window = globalThis;
globalThis.document = {
  getElementById: function () { return makeEl(); },
  querySelector:  function () { return makeEl(); },
  querySelectorAll: function () { return []; },
  createElement: makeEl,
  documentElement: makeEl('html'),
  body: makeEl('body'),
  addEventListener: noop,
};
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.matchMedia = function () { return { matches: false, addEventListener: noop, addListener: noop }; };
globalThis.getComputedStyle = function () { return { getPropertyValue: function () { return 'monospace'; } }; };
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
};
globalThis.devicePixelRatio = 1;
globalThis.ResizeObserver   = function () { this.observe = noop; this.disconnect = noop; };
globalThis.MutationObserver = function () { this.observe = noop; this.disconnect = noop; };
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.cancelAnimationFrame = noop;
/* A real timer queue, not a no-op. save() is debounced, and flushSave()
 * only writes when a timer is actually pending — stub setTimeout to return
 * 0 and every write is skipped, so a round-trip test would "pass" against
 * an app that never saved anything. Callbacks are held, never auto-run;
 * flushSave() does the writing. */
var timers = {}, nextTimer = 1;
globalThis.setTimeout = function (fn) { var id = nextTimer++; timers[id] = fn; return id; };
globalThis.clearTimeout = function (id) { delete timers[id]; };
if (typeof globalThis.performance === 'undefined') globalThis.performance = { now: function () { return 0; } };

(0, eval)(readFile('unit-model.js'));

var canvas = makeEl('canvas');
canvas.parentNode = makeEl('div');
var api = window.UnitModel.create(canvas, {});

var want = typeof PLAN !== 'undefined' ? [PLAN] : api.plans().map(function (p) { return p.id; });

want.forEach(function (id) {
  api.selectPlan(id);
  var p = api.plan(), f = api.fit(), a = api.area(), c = api.config();
  print('══ ' + p.name + '  (' + p.id + ')  ' + p.tag + ' ══');
  print('   ' + p.sub);
  print('   envelope  ' + c.W.toFixed(3) + "' x " + c.D.toFixed(3) + "'");
  print('   gross ' + a.gross.toFixed(1) + ' sf   net ' + a.net.toFixed(1) + ' sf');
  print('   problems: ' + (f.problems.length ? f.problems.join(' | ') : 'none'));
  f.sections.forEach(function (s) {
    var bad = s.rows.filter(function (r) { return r.state === 'fail'; });
    var tight = s.rows.filter(function (r) { return r.state === 'tight'; });
    print('   ' + s.title + ' — ' + s.rows.length + ' rows, ' +
          bad.length + ' fail, ' + tight.length + ' tight' +
          (bad.length ? '  [' + bad.map(function (r) { return r.label; }).join(', ') + ']' : ''));
  });
  print('   config rows: ' + api.configSections().reduce(function (n, s) { return n + s.rows.length; }, 0) +
        '   derived: ' + api.derived().length);
  print('   area rows : ' + f.areaRows.map(function (r) { return r.label + ' ' + r.sf; }).join(' · '));
  print('');
});

/* ── save-state round trip ────────────────────────────────────────────
 * Place furniture in every apartment, snapshot, wipe storage entirely,
 * restore, and check each apartment got its own pieces back. Wiping is
 * the point: it stands in for the origin changing, site data being
 * cleared, or opening the file on another machine — the cases the
 * project file exists to survive.
 */
print('══ save state — snapshot / wipe / restore ══');

var ids = api.plans().map(function (p) { return p.id; });
var want = {};
ids.forEach(function (id, n) {
  api.selectPlan(id);
  var keys = api.catalog()[0].items.slice(0, n + 2).map(function (i) { return i.k; });
  keys.forEach(function (k) { api.add(k); });
  want[id] = api.placed().length;
  print('  ' + id + ': placed ' + want[id] + ' pieces');
});

var doc = api.snapshot();
print('  snapshot: format=' + doc.format + ' active=' + doc.activePlan +
      ' apartments=' + Object.keys(doc.plans).join(',') +
      ' bytes=' + JSON.stringify(doc).length);

Object.keys(mem).forEach(function (k) { delete mem[k]; });   // wipe the browser store
print('  storage wiped (' + Object.keys(mem).length + ' keys left)');

var res = api.restoreProject(doc);
print('  restore: ok=' + res.ok + ' restored=[' + (res.restored || []).join(', ') + ']' +
      ((res.skipped || []).length ? ' skipped=[' + res.skipped.join(', ') + ']' : ''));

var bad = 0;
ids.forEach(function (id) {
  api.selectPlan(id);
  var got = api.placed().length;
  var ok = got === want[id];
  if (!ok) bad++;
  print('  ' + id + ': expected ' + want[id] + ', got ' + got + '  ' + (ok ? 'OK' : '*** MISMATCH ***'));
});

var junk = api.restoreProject({ format: 'nope' });
print('  rejects a non-project file: ' + (junk.ok === false ? 'OK — "' + junk.reason + '"' : '*** ACCEPTED ***'));

print(bad ? '\n  *** ' + bad + ' APARTMENT(S) LOST WORK ***' : '\n  round trip clean.');
