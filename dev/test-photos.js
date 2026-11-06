#!/usr/bin/env node
// Persistence and the actual Home pool/refresh functions, without a browser.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Store, photoFlags } = require('../app/service/store.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-photos-'));
const defaults = { on: true, home: true, saver: true };
let checks = 0;
function eq(got, want) { assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), want); checks++; }

(async () => {
  try {
    fs.mkdirSync(path.join(tmp, 'wallpapers'));
    const manifest = path.join(tmp, 'wallpapers', 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify(['keep.jpg', 'gone.jpg', '__proto__', 'constructor', 'prototype', '../escape.jpg'].map(file => ({ file }))));
    const dir = path.join(tmp, 'data');
    let s = new Store(dir, null, tmp);
    s.load();
    eq(Object.keys(s.manifest), ['keep.jpg', 'gone.jpg']);
    assert.strictEqual(Object.getPrototypeOf(s.state.bundled), null); checks++;
    const old = 'a'.repeat(24), orphan = 'b'.repeat(24);
    fs.writeFileSync(s.photoPath(old), 'old');
    fs.writeFileSync(s.photoPath(orphan), 'orphan');
    s.state.photos = [{ id: old, added: 1, home: false }];
    s.state.bundled = JSON.parse('{"keep.jpg":{"on":false,"saver":false},"gone.jpg":{"home":false},"unknown.jpg":{},"__proto__":{"on":false},"constructor":{},"prototype":{}}');
    s.save();
    s = new Store(dir, null, tmp);
    s.load();
    eq(s.state.v, 1);
    eq(Object.keys(s.state.bundled), ['keep.jpg', 'gone.jpg']);
    eq(s.state.bundled['keep.jpg'], { on: false, home: true, saver: false });
    eq(photoFlags(s.findPhoto(old)), { on: true, home: false, saver: true });
    eq(photoFlags(s.findPhoto(orphan)), defaults);
    eq(photoFlags({}), defaults); // newly uploaded minimal records
    assert.strictEqual(Object.getPrototypeOf(s.state.bundled), null); checks++;
    fs.writeFileSync(manifest, '[{"file":"keep.jpg"}]');
    s = new Store(dir, null, tmp);
    s.load();
    eq(Object.keys(s.state.bundled), ['keep.jpg']);
    s.state.bundled['unknown.jpg'] = { on: false };
    s._reconcile();
    s.save();
    eq(Object.keys(JSON.parse(fs.readFileSync(s.file)).bundled), ['keep.jpg']);
    eq(s.state.bundled['keep.jpg'], { on: false, home: true, saver: false });

    // Run the production pool builder: absent flags, every gate combination,
    // separate Home/Saver sets, and no fallback on either empty pool.
    const source = fs.readFileSync(path.join(__dirname, '../app/js/home.js'), 'utf8');
    let state = { photos: [
      { id: 'old' }, { id: 'off', on: false }, { id: 'away', home: false },
      { id: 'home', on: true, home: true, saver: false }
    ], bundled: { 'off.jpg': { on: false }, 'away.jpg': { home: false }, 'home.jpg': { saver: false } } };
    let pool, rebuilds = 0, ambient = false;
    const ctx = vm.createContext({
      document: { documentElement: { classList: { contains: () => ambient } } },
      window: { addEventListener() {} },
      D: { cached: () => state, media: p => p, refresh: () => Promise.resolve({ online: true, changed: true, state }) },
      ls: { get: () => [], set: () => {} },
      bundled: ['old.jpg', 'off.jpg', 'away.jpg', 'home.jpg'].map(file => ({ key: 'w:' + file })),
      backdrop: { setPhotos: items => { pool = items; } }, shortcuts: [], mode: 'dock',
      rebuildDock: () => { rebuilds++; }
    });
    vm.runInContext(source.slice(source.indexOf('  function updatePhotos('), source.indexOf('  // Bundled photos are tagged')), ctx);
    vm.runInContext(source.slice(source.indexOf('  function refresh()'), source.indexOf('  function waitHealthy(')), ctx);
    ctx.updatePhotos();
    eq(pool.map(p => p.key), ['w:old.jpg', 'w:home.jpg', 'u:old', 'u:home']);
    ambient = true;
    ctx.updatePhotos();
    eq(pool.map(p => p.key), ['w:old.jpg', 'w:away.jpg', 'u:old', 'u:away']);
    state.photos.forEach(p => { p.on = false; });
    ctx.bundled.forEach(p => { state.bundled[p.key.slice(2)] = { on: false }; });
    ctx.updatePhotos();
    eq(pool, []);
    ambient = false;
    ctx.updatePhotos();
    eq(pool, []);
    await ctx.refresh();
    eq(rebuilds, 0);
    state.shortcuts = [{ id: 'shortcut', name: 'A' }];
    await ctx.refresh();
    eq(rebuilds, 1);
    state = JSON.parse(JSON.stringify(state));
    state.photos.push({ id: 'new' });
    await ctx.refresh();
    eq(rebuilds, 1);
    state.shortcuts = [{ id: 'shortcut', name: 'B' }];
    await ctx.refresh();
    eq(rebuilds, 2);
    // Phone controls use the same flags and route bundled cards away from Delete.
    const html = fs.readFileSync(path.join(__dirname, '../app/service/web/index.html'), 'utf8');
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
    scripts.forEach(script => new vm.Script(script.replace(/^<script[^>]*>|<\/script>$/g, '')));
    function el(tag, cls, text) {
      return { tag, className: cls, textContent: text, children: [], events: {}, classList: { add() {} },
        appendChild(child) { this.children.push(child); }, setAttribute() {}, addEventListener(k, fn) { this.events[k] = fn; } };
    }
    let response = { status: 200, data: { flags: { on: false, home: true, saver: true } } };
    let sent, viewed = 0, warned = 0;
    const phone = vm.createContext({ el, Image: function () { return el('img'); },
      document: { createTextNode: text => text }, openViewer: () => { viewed++; }, toast: () => { warned++; },
      api: (method, url, body) => { sent = { method, url, body }; return Promise.resolve(response); } });
    vm.runInContext(html.slice(html.indexOf('  function photoTile('), html.indexOf('  function renderPhotos(')), phone);
    const picture = { file: 'keep.jpg', title: 'Keep', thumb: '/media/bundled/keep.jpg' };
    const tile = phone.photoTile(picture);
    const toggle = tile.children[2].children[0], home = tile.children[2].children[1].children[0];
    const saver = tile.children[2].children[2].children[0];
    eq([tile.children[0].tag, toggle.textContent, home.checked], ['div', 'Hide', true]);
    toggle.events.click();
    eq([toggle.disabled, home.disabled, saver.disabled], [true, true, true]);
    await Promise.resolve();
    eq(sent, { method: 'PATCH', url: '/api/bundled/keep.jpg', body: { on: false } });
    eq([toggle.textContent, toggle.disabled, home.checked], ['Show', false, true]);
    eq(saver.checked, true);
    response = { status: 200, data: { flags: { on: false, home: true, saver: false } } };
    saver.checked = false;
    saver.events.change();
    await Promise.resolve();
    eq(sent, { method: 'PATCH', url: '/api/bundled/keep.jpg', body: { saver: false } });
    eq([picture.saver, saver.checked, saver.disabled, home.checked], [false, false, false, true]);
    response = { status: 0, data: {} };
    saver.checked = true;
    saver.events.change();
    await Promise.resolve();
    eq([picture.saver, saver.checked, saver.disabled, warned], [false, false, false, 1]);
    home.checked = false;
    home.events.change();
    await Promise.resolve();
    eq([home.checked, home.disabled, warned], [true, false, 2]);
    const uploadTile = phone.photoTile({ id: 'upload', home: false });
    eq(uploadTile.children[0].tag, 'button');
    uploadTile.children[0].events.click();
    eq(viewed, 1);
    const uploadSaver = uploadTile.children[2].children[2].children[0];
    response = { status: 200, data: { flags: { on: true, home: false, saver: false } } };
    uploadSaver.checked = false;
    uploadSaver.events.change();
    await Promise.resolve();
    eq(sent, { method: 'PATCH', url: '/api/photos/upload', body: { saver: false } });
    eq([uploadSaver.checked, uploadSaver.disabled], [false, false]);
    console.log(checks + ' photo checks, 0 failed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
