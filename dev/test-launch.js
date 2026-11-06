#!/usr/bin/env node
// Launch ownership and every return route, with deterministic timers/DOM.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(require('path').join(__dirname, '../app/js/home.js'), 'utf8');
const timers = [], requests = [], events = {}, messages = [];
let cancelled = 0, checks = 0, animateCalls = 0, throwAt = 0;
function element() {
  const classes = new Set();
  return { style: {}, children: [],
    set textContent(value) { this.children = []; },
    appendChild(child) { this.children.push(child); },
    getBoundingClientRect: () => ({ width: 156, height: 156, top: 10, left: 10 }),
    querySelector: selector => selector === '.face' ? element() : null,
    animate: (frames, options) => {
      if (++animateCalls === throwAt) throw new Error('animation unavailable');
      return { options, onfinish: null,
        dispatchEvent(e) { if (e.type === 'finish' && this.onfinish) this.onfinish(e); },
        cancel() { cancelled++; }, reverse() { throw new Error('must never reverse'); } };
    },
    classList: { add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k) } };
}
const launch = element();
const backdrop = { pause() { assert(!launch.classList.contains('on')); }, resume() { assert(!launch.classList.contains('on')); } };
const ctx = vm.createContext({
  $: () => launch, div: element, stage: element(), tileEls: {}, cfg: {}, Q: {},
  document: { body: element(), hidden: false, documentElement: element(), addEventListener: (k, fn) => { events[k] = fn; } },
  window: { addEventListener: (k, fn) => { events[k] = fn; } },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
  setInterval() {}, clearInterval() {}, saveFocus() {}, renderClock() {}, whenIdle() {},
  clockTimer: null, pollTimer: null, retryTimer: null, longTimer: null, enterDown: false,
  nowPlaying: null, backdrop, refresh() {},
  KEY: { BACK: 10009, ESC: 27, BACKSPACE: 8, LEFT: 37, RIGHT: 39, UP: 38, DOWN: 40, ENTER: 13 },
  S: { select() {} }, recordAppUse() {}, toast: s => messages.push(s),
  P: { launchApp: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) }
});
vm.runInContext(source.slice(source.indexOf("  var launchEl ="), source.indexOf('  // ---------- long-press menu')), ctx);
vm.runInContext(source.slice(source.indexOf('  function onKeyDown('), source.indexOf('  function onKeyUp(')), ctx);
vm.runInContext(source.slice(source.indexOf('  function onVisibility('), source.indexOf('  var lastKeyAt')), ctx);
vm.runInContext(source.slice(source.indexOf("    document.addEventListener('keydown'"), source.indexOf('    nowPlaying = new GH.NowPlaying')).replace("    document.addEventListener('keyup', onKeyUp, true);", ''), ctx);
const app = { kind: 'app', id: 'app', key: 'app', el: element(), tint: '#ff0033' };
function ok(cond) { assert(cond); checks++; }
(async () => {
  ctx.activate(app);
  ok(launch.classList.contains('on'));
  const oldTimer = timers[timers.length - 1];
  ok(oldTimer.ms === 2000); // starts before the platform promise settles
  events.visibilitychange.call(null); // even visible without a preceding hidden event
  ok(!launch.classList.contains('on'));
  ctx.activate(app);
  const newer = ctx.launching;
  requests[0].reject(new Error('late error'));
  await Promise.resolve();
  oldTimer.fn(); // simulate an already queued cancelled timer
  ok(ctx.launching === newer && messages.length === 0);
  events.keydown({ keyCode: 0 });
  ok(!launch.classList.contains('on'));
  ctx.activate(app);
  events.focus();
  ok(!launch.classList.contains('on'));
  ctx.activate(app);
  events.pointerdown();
  ok(!launch.classList.contains('on'));
  ctx.activate(app);
  ctx.document.hidden = true;
  events.visibilitychange();
  ok(!launch.classList.contains('on'));
  ctx.document.hidden = false;
  events.visibilitychange();
  const before = cancelled;
  ctx.endLaunch(true); ctx.endLaunch(true);
  ok(cancelled === before);
  ctx.activate(app);
  timers[timers.length - 1].fn(); // no visibilitychange, no platform callback
  ok(!launch.classList.contains('on') && !ctx.launching);
  ctx.cfg.launchAnimation = false;
  ctx.activate(app);
  const noZoom = requests[requests.length - 1];
  ctx.cfg.launchAnimation = true;
  ctx.activate(app);
  const latest = ctx.launching;
  noZoom.reject(new Error('late unanimated launch'));
  await Promise.resolve();
  ok(ctx.launching === latest);
  requests[1].resolve('preview:old');
  await Promise.resolve();
  ok(ctx.launching === latest && messages.length === 0);
  const beforeFailure = cancelled;
  throwAt = animateCalls + 2; // first animation succeeds, second throws
  ctx.activate(app);
  ok(!ctx.launching && !launch.classList.contains('on') && cancelled === beforeFailure + 3);
  throwAt = 0;
  ctx.startLaunch(app);
  const zoom = ctx.launching.anims[0], fade = ctx.launching.anims[1];
  const guard = timers[timers.length - 1];
  ok(zoom.options.duration === 380 && guard.ms === 2000);
  ok(launch.children.length === 1 && launch.classList.contains('on'));
  fade.dispatchEvent({ type: 'finish' });
  ok(launch.children.length === 1 && launch.classList.contains('on'));
  const beforeFinish = cancelled;
  zoom.dispatchEvent({ type: 'finish' }); // still visible, no platform callback
  ok(!ctx.launching && !launch.classList.contains('on') && launch.children.length === 0);
  ok(cancelled === beforeFinish + 2 && guard.cleared);
  ctx.endLaunch(); ctx.endLaunch();
  zoom.dispatchEvent({ type: 'finish' });
  guard.fn();
  ok(cancelled === beforeFinish + 2 && launch.children.length === 0 && !ctx.launching);
  ctx.startLaunch(app);
  const superseded = ctx.launching.anims[0];
  ctx.startLaunch(app);
  const current = ctx.launching, card = launch.children[0];
  const currentGuard = timers[timers.length - 1], beforeStale = cancelled;
  superseded.dispatchEvent({ type: 'finish' });
  zoom.dispatchEvent({ type: 'finish' });
  ok(ctx.launching === current && launch.classList.contains('on') && launch.children[0] === card);
  ok(cancelled === beforeStale && !currentGuard.cleared);
  currentGuard.fn(); // missing finish event still falls back to the 2 s guard
  ok(!ctx.launching && !launch.classList.contains('on') && launch.children.length === 0);
  current.anims[0].dispatchEvent({ type: 'finish' });
  ctx.endLaunch();
  ok(cancelled === beforeStale + 2);
  console.log(checks + ' launch checks, 0 failed');
})().catch(e => { console.error(e); process.exitCode = 1; });
