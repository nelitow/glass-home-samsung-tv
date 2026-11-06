#!/usr/bin/env node
// Real ambient handlers, Home pool wiring and backdrop, with controlled decodes/timers.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = name => fs.readFileSync(path.join(__dirname, '../app/js/' + name + '.js'), 'utf8');
let checks = 0;
function ok(value, label) { assert(value, label); checks++; }
function element() {
  const classes = new Set();
  return { textContent: '', style: {}, appendChild(img) { this.textContent = img.src; },
    classList: { add: k => classes.add(k), remove: k => classes.delete(k),
      contains: k => classes.has(k), toggle(k, on) { if (on) classes.add(k); else classes.delete(k); } } };
}
function surface(obj) {
  const listeners = {};
  obj.addEventListener = (name, fn) => { (listeners[name] || (listeners[name] = [])).push(fn); };
  obj.dispatchEvent = event => { (listeners[event.type] || []).forEach(fn => fn(event)); };
  return obj;
}
function setup() {
  let serial = 0;
  const timers = new Map(), decodes = [], frames = [];
  const html = element();
  const document = surface({ documentElement: html, hidden: false,
    getElementById: () => null, createElement: () => ({}) });
  const window = surface({ GH: { config: { ambient: { afterMs: 1000 } },
    ls: { get: () => null, set() {} } } });
  const state = { photos: [
    { id: 'home', url: 'home.jpg', saver: false },
    { id: 'saver', url: 'saver.jpg', home: false },
    { id: 'both', url: 'both.jpg' },
    { id: 'off', url: 'off.jpg', on: false }
  ] };
  const ctx = vm.createContext({ window, document, Promise, Date, Math,
    Event: function (type) { this.type = type; },
    Image: function () { this.decode = () => new Promise((resolve, reject) => decodes.push({ resolve, reject })); },
    setTimeout: (fn, ms) => { timers.set(++serial, { fn, ms }); return serial; },
    clearTimeout: id => timers.delete(id), setInterval() {}, clearInterval() {},
    requestAnimationFrame: fn => frames.push(fn),
    D: { cached: () => state, media: p => p }, ls: window.GH.ls, bundled: []
  });
  vm.runInContext(source('backdrop'), ctx);
  const b = new window.GH.Backdrop(element(), element(), {});
  ctx.backdrop = b;
  const home = source('home');
  vm.runInContext(home.slice(home.indexOf('  function updatePhotos('), home.indexOf('  // Bundled photos are tagged')), ctx);
  vm.runInContext(source('ambient'), ctx);
  function fire(ms) {
    const pair = Array.from(timers).find(pair => pair[1].ms === ms);
    assert(pair, 'missing timer ' + ms);
    timers.delete(pair[0]); pair[1].fn();
  }
  function frame() { frames.splice(0).forEach(fn => fn()); }
  function finishFade() { frame(); fire(1720); }
  async function decode(fail) {
    const job = decodes.shift();
    assert(job, 'missing decode');
    if (fail) job.reject(); else job.resolve();
    await Promise.resolve(); await Promise.resolve();
  }
  function event(type, extra) {
    const e = Object.assign({ type, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; } }, extra);
    window.dispatchEvent(e); return e;
  }
  async function start(key) {
    ctx.updatePhotos(); b.start('u:' + key); await decode(); finishFade();
  }
  return { ctx, b, html, window, document, state, timers, decodes, frames, fire, frame, finishFade, decode, event, start };
}
(async () => {
  for (const wakeEvent of ['appcontrol', 'focus']) {
    const t = setup(), b = t.b;
    let exits = 0, otherFocus = 0;
    t.window.addEventListener('gh:ambient-exit', () => exits++);
    t.window.addEventListener('focus', () => otherFocus++);
    await t.start('home');
    t.fire(1000);
    ok(t.html.classList.contains('ambient'), 'idle engages');
    ok(b.items.map(p => p.key).join() === 'u:saver,u:both', 'Saver excludes off and saver:false');
    ok(b.current.key === 'u:home' && b.layers[b.front].textContent === 'home.jpg' && b.busy,
      'switch retains visible canvas during decode');
    await t.decode(); t.finishFade();
    const previous = b.current.key;
    t.event(wakeEvent);
    ok(!t.html.classList.contains('ambient') && exits === 1, wakeEvent + ' wakes via shared path');
    ok(b.items.map(p => p.key).join() === 'u:home,u:both', 'wake restores Home pool');
    ok(b.held, 'wake holds normal rotation for navigation');
    ok(b.busy === (previous !== 'u:both'), 'wake advances only when current is outside Home');
    const loadId = b.loadId, timerIds = Array.from(t.timers.keys()).join();
    t.event('appcontrol'); t.event('focus');
    ok(exits === 1 && loadId === b.loadId && timerIds === Array.from(t.timers.keys()).join(),
      'foreground appcontrol/focus are no-ops');
    ok(otherFocus === (wakeEvent === 'focus' ? 2 : 1), 'existing focus listener still runs');
  }

  { // Overlap: neither transition advances, even if a normal decode was pending.
    const t = setup(), b = t.b;
    await t.start('both');
    b.advance(b.byKey['u:home']);
    t.fire(1000);
    ok(!b.busy && b.current.key === 'u:both', 'enter keeps shared current');
    await t.decode();
    ok(b.current.key === 'u:both', 'old Home decode cannot appear in Saver');
    const show = b.showId, due = b.dueAt;
    t.event('appcontrol');
    ok(!b.busy && b.showId === show && b.dueAt === due, 'wake keeps shared current and schedule');
    t.fire(1000);
    const key = t.event('keydown', { keyCode: 13 });
    ok(key.prevented && key.stopped && !t.html.classList.contains('ambient'), 'keydown still wakes and swallows');
    const up = t.event('keyup', { keyCode: 13 });
    ok(up.prevented && up.stopped, 'matching keyup is swallowed');
    t.fire(1000);
    t.document.dispatchEvent({ type: 'visibilitychange' });
    ok(!t.html.classList.contains('ambient'), 'visible visibilitychange still wakes');
  }

  { // Empty Saver never falls back to Home, and stale callbacks cannot revive it.
    const t = setup(), b = t.b;
    await t.start('home');
    t.state.photos.forEach(p => { p.saver = false; });
    b.advance(b.byKey['u:both']);
    t.fire(1000);
    await t.decode(); t.frame();
    ok(!b.current && !b.busy && b.layers.every(l => !l.textContent), 'empty Saver is neutral after stale decode');
    t.event('focus'); await t.decode(); t.finishFade();
    ok(b.current && b.byKey[b.current.key], 'Home reloads after empty Saver');
  }

  { // Switch back before Saver decodes: old generation must not release new work.
    const t = setup(), b = t.b;
    t.state.photos = t.state.photos.filter(p => p.id !== 'both');
    await t.start('home');
    t.fire(1000); t.event('appcontrol'); t.fire(1000);
    await t.decode();
    ok(b.busy && b.current.key === 'u:home', 'stale decode cannot release newer generation');
    await t.decode(); t.frame();
    t.event('focus'); await t.decode();
    ok(b.current.key === 'u:saver' && b.pendingImg && b.layers.every(l => l.textContent),
      'rapid wake waits for outgoing fade layer before repaint');
    t.fire(1720); t.finishFade();
    ok(b.current.key === 'u:home' && !b.pendingImg && !b.fading, 'queued Home image shows after fade');
  }

  { // A failed/hung Saver image times out to neutral, then retries on schedule.
    const t = setup(), b = t.b;
    t.state.photos = t.state.photos.filter(p => p.id !== 'both');
    await t.start('home');
    // Retire the completed initial image's harmless decode watchdog.
    t.fire(20000);
    t.fire(1000); t.fire(20000);
    await Promise.resolve(); await Promise.resolve();
    ok(!b.current && !b.busy && b.layers.every(l => !l.textContent), 'decode timeout cannot strand old pool');
    ok(Array.from(t.timers.values()).some(t => t.ms === 45000), 'failed pool retains retry schedule');
    await t.decode();
    ok(!b.current, 'late success after timeout cannot revive old work');
    t.event('appcontrol'); await t.decode(); t.finishFade();
    ok(b.current.key === 'u:home', 'wake recovers from failed Saver');
  }

  { // A hidden app can switch pools while paused; resume must evict immediately.
    const t = setup(), b = t.b;
    t.state.photos = t.state.photos.filter(p => p.id !== 'both');
    await t.start('home');
    t.fire(1000); await t.decode(); t.finishFade();
    b.pause(); t.event('appcontrol');
    ok(!b.busy && b.current.key === 'u:saver', 'paused swap defers decode');
    b.resume(); await t.decode(); t.finishFade();
    ok(b.current.key === 'u:home', 'resume evicts out-of-pool current');
  }

  { // Hide edits must still evict immediately, including a queued replacement.
    const t = setup(), b = t.b;
    t.state.photos = t.state.photos.filter(p => p.id !== 'both');
    await t.start('home');
    t.fire(1000); await t.decode(); t.frame();
    t.event('appcontrol'); await t.decode();
    t.state.photos[0].on = false;
    t.ctx.updatePhotos();
    t.fire(1720); t.frame();
    ok(!b.current && !b.pendingImg && !b.fading && b.layers.every(l => !l.textContent),
      'Hide during queued fade clears both generations');
    t.fire(1000); await t.decode(); t.finishFade();
    ok(b.current.key === 'u:saver', 'Saver still works with an empty Home');
    t.event('focus');
    ok(!b.current && b.layers.every(l => !l.textContent), 'waking into empty Home stays neutral');
  }

  { // Bound retries when a nonempty pool contains only broken images.
    const t = setup(), b = t.b;
    t.state.photos = [t.state.photos[0]];
    for (let i = 0; i < 8; i++) t.state.photos.push({ id: 'bad' + i, url: 'bad' + i, home: false });
    await t.start('home');
    t.fire(1000);
    for (let i = 0; i < 7; i++) await t.decode(true);
    ok(!b.current && !b.busy && b.layers.every(l => !l.textContent), 'exhausted retry batch retires old pool');
    t.fire(45000); await t.decode(); t.finishFade();
    ok(b.current && b.byKey[b.current.key], 'retry schedule reaches remaining Saver candidate');
  }
  console.log(checks + ' ambient/pool checks, 0 failed');
})().catch(e => { console.error(e); process.exitCode = 1; });
