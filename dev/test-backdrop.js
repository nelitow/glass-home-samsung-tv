#!/usr/bin/env node
// Unit tests for the photo rotation logic in app/js/backdrop.js (no browser:
// the DOM, image decoder and timers are stubbed).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'js', 'backdrop.js'), 'utf8');
let fails = 0;
let count = 0;
function ok(label, cond, detail) { count++; if (!cond) { fails++; console.log('FAIL ' + label + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); } }

function load(store, env) {
  const window = { GH: { ls: { get: (k) => store[k] || null, set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); } } } };
  const ctx = vm.createContext(Object.assign({ window, Math, Date, JSON, setTimeout: () => 0, clearTimeout: () => {}, Promise, Image: function () {}, requestAnimationFrame: () => 0 }, env));
  vm.runInContext(src, ctx);
  return window.GH.Backdrop;
}

function items(n, prefix, extra) { return Array.from({ length: n }, (_, i) => Object.assign({ key: prefix + i, url: prefix + i + '.jpg', credit: '' }, extra || {})); }
function walk(b, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const it = b._pick(); out.push(it && it.key); b.current = it; if (it) b._markSeen(it.key); }
  return out;
}

{ // same order all day, every photo once before any repeats
  const store = {};
  const B = load(store);
  const b = new B({}, {}, {});
  b.setPhotos(items(12, 'w:'));
  const seq = walk(b, 12);
  ok('12 picks cover all 12 photos', new Set(seq).size === 12, seq);
  const b2 = new (load({}))({}, {}, {});
  b2.setPhotos(items(12, 'w:').reverse());
  ok('order does not depend on list order (seeded by the date)', JSON.stringify(walk(b2, 12)) === JSON.stringify(seq));
  const next = walk(b, 12);
  ok('the next cycle shows all 12 again, never the same photo twice in a row', next[0] !== seq[11] && new Set(next).size === 12, next);
}

{ // the cycle continues across an app restart on the same day
  const store = {};
  const B = load(store);
  const b = new B({}, {}, {});
  b.setPhotos(items(10, 'w:'));
  const first = walk(b, 4);
  const b2 = new (load(store))({}, {}, {});
  b2.setPhotos(items(10, 'w:'));
  const rest = walk(b2, 6);
  ok('after a restart the remaining photos come next', new Set(first.concat(rest)).size === 10, { first, rest });
}

{ // new uploads jump the queue
  const B = load({});
  const b = new B({}, {}, {});
  b.setPhotos(items(8, 'w:').concat(items(3, 'u:', { user: true })));
  walk(b, 2);
  b.setPhotos(items(8, 'w:').concat(items(3, 'u:', { user: true })).concat([{ key: 'u:new', url: 'n.jpg', user: true, fresh: true }]));
  ok('a fresh upload is shown next', b._pick().key === 'u:new');
  b.setPhotos(items(8, 'w:').concat(items(3, 'u:', { user: true })).concat([{ key: 'u:new', url: 'n.jpg', user: true, fresh: true }]));
  ok('a fresh upload is not queued twice', b.fresh.indexOf('u:new') < 0);
}

{ // failures are skipped, then retried after 10 minutes
  const B = load({});
  const b = new B({}, {}, {});
  b.setPhotos(items(3, 'w:'));
  b._ensureOrder();
  const victim = b.order[0];
  b.bad[victim] = Date.now();
  ok('a failed photo is skipped', b._pick().key !== victim);
  b.bad[victim] = Date.now() - 11 * 60 * 1000;
  ok('and retried after 10 minutes', b._isBad(victim) === false);
}

{ // one photo only: nothing else to pick
  const B = load({});
  const b = new B({}, {}, {});
  b.setPhotos(items(1, 'w:'));
  const a = b._pick();
  b.current = a; b._markSeen(a.key);
  ok('with a single photo there is no next photo', b._pick() === null);
}

// Decode, pause and fade races: actual production methods with tiny DOM/timer stubs.
(async () => {
  async function flush() { await Promise.resolve(); await Promise.resolve(); }
  function layer() {
    const classes = new Set();
    return { textContent: '', style: {}, appendChild() { this.textContent = 'image'; },
      classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k) } };
  }
  const decodes = [], frames = [], timers = [];
  function Image() { this.decode = () => new Promise((resolve, reject) => decodes.push({ resolve, reject })); }
  const B = load({}, { Image, document: { createElement: () => ({}) },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    requestAnimationFrame: fn => frames.push(fn) });
  const a = layer(), c = layer();
  let credit = 'old';
  const b = new B(a, c, { onShow: p => { credit = p; } });
  const photos = items(3, 'w:');
  b.setPhotos(photos);
  b.start(photos[0].key);
  decodes.shift().resolve();
  await flush();
  frames.shift()();
  ok('initial image shown', b.current.key === photos[0].key && a.textContent === 'image');
  b.advance(photos[1]);
  const stale = decodes.shift();
  b.setPhotos([photos[2]]);
  ok('F1 clears current immediately even while a decode is busy', b.current === null && a.textContent === '' && credit === null);
  stale.resolve();
  await flush();
  ok('retired decode cannot show or release a newer decode', b.current === null && b.busy);
  decodes.shift().resolve();
  await flush();
  ok('F1 advances to remaining member', b.current.key === photos[2].key);
  b.setPhotos([]);
  frames.splice(0).forEach(fn => fn());
  timers.filter(t => t.ms < 2000).forEach(t => t.fn());
  ok('empty Home stays neutral after stale frames and fade timers', !b.current && !b.busy && !a.textContent && !c.textContent && !a.classList.contains('show') && credit === null);
  ok('empty Home does not resurrect the order', b._pick() === null);
  b.pause(); b.resume();
  ok('empty Home remains empty after resume', !b.current && !b.busy);

  b.setPhotos(photos);
  decodes.shift().resolve();
  await flush();
  frames.splice(0).forEach(fn => fn());
  const current = b.current;
  const next = photos.find(p => p.key !== current.key);
  b.advance(next);
  const pending = decodes.shift();
  b.pause(); pending.resolve();
  await flush();
  ok('decode can finish while paused', !!b.pendingImg);
  b.setPhotos([current]);
  b.resume();
  ok('hidden pending image is not shown on resume', b.current.key === current.key && !b.pendingImg);
  b.pause(); b.setPhotos([]);
  ok('eviction while paused clears immediately', !b.current && !a.textContent && !c.textContent);
  b.setPhotos([next]); b.resume();
  decodes.shift().resolve();
  await flush();
  ok('re-enabling after empty/paused loads normally', b.current.key === next.key);

  frames.splice(0).forEach(fn => fn());
  timers.filter(t => t.ms === 1720).forEach(t => t.fn());
  b.setPhotos(photos);
  b._show(current, {}, false);
  frames.splice(0).forEach(fn => fn());
  timers.filter(t => t.ms === 1720).forEach(t => t.fn());
  b._show(next, {}, false);
  frames.splice(0).forEach(fn => fn());
  ok('both sides of fade tracked', b.shownKeys.indexOf(current.key) >= 0 && b.shownKeys.indexOf(next.key) >= 0);
  b.setPhotos([next]);
  ok('hiding outgoing layer retires it immediately', !a.textContent && !c.textContent);
  decodes.shift().resolve();
  await flush();
  frames.splice(0).forEach(fn => fn());
  timers.filter(t => t.ms === 1720).forEach(t => t.fn());
  ok('old fade cleanup cannot erase replacement', b.current.key === next.key && b.layers[b.front].textContent === 'image');

  console.log(count + ' checks, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
