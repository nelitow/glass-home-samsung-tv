#!/usr/bin/env node
// Exercise the real service handler without opening sockets (sandbox-safe).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { Readable, Writable } = require('stream');
const { createRequire } = require('module');
const appDir = path.join(__dirname, '../app');
const file = path.join(appDir, 'service/server.js');
const requireService = createRequire(file);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-photo-api-'));
let handle, svc, cookie, checks = 0;
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  require: name => name === 'http' ? { createServer: fn => {
    handle = fn;
    return { once() {}, on() {}, removeListener() {}, listen(port, host, cb) { cb(); }, close(cb) { cb(); } };
  } } : requireService(name),
  module: mod, __dirname: path.dirname(file), process, console, Buffer,
  setTimeout, clearTimeout, setInterval, clearInterval
});
function eq(got, want) { assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), want); checks++; }
function request(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = Readable.from(bytes.length ? [bytes] : []);
    req.headers = Object.assign({ host: '127.0.0.1:8090', 'x-gh': '1', cookie: cookie || '',
      'content-type': 'application/json', 'content-length': String(bytes.length) }, headers);
    req.socket = { remoteAddress: '127.0.0.1', destroy() {} };
    req.method = method; req.url = url;
    req.on('end', () => { req.complete = true; });
    const timeout = setTimeout(() => reject(new Error('No response: ' + method + ' ' + url)), 3000);
    const chunks = [];
    const res = new Writable({ write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
    res.headersSent = false;
    res.setHeader = () => {};
    res.writeHead = status => { res.status = status; res.headersSent = true; };
    res.on('error', e => { clearTimeout(timeout); reject(e); });
    res.on('finish', () => {
      clearTimeout(timeout);
      const raw = Buffer.concat(chunks);
      let data;
      try { data = JSON.parse(raw); } catch (e) { data = null; }
      resolve({ status: res.status, data, raw });
    });
    handle(req, res);
  });
}
async function start() {
  svc = mod.exports.createService({ appDir, dataDir: tmp, hosts: ['127.0.0.1'], config: { fetchIcons: false }, log() {} });
  await new Promise((resolve, reject) => svc.start(e => e ? reject(e) : resolve()));
}
(async () => {
  try {
    // A crash-recovered orphan has no flags at all.
    fs.mkdirSync(path.join(tmp, 'photos'));
    const orphan = 'a'.repeat(24);
    fs.writeFileSync(path.join(tmp, 'photos', orphan + '.jpg'), 'orphan');
    await start();
    eq((await request('PATCH', '/api/photos/' + orphan, { on: false })).status, 401);
    cookie = 'gh_sid=' + svc.devCreateSession();
    let r = await request('GET', '/api/photos');
    const bundled = r.data.bundled[0].file;
    function flags(p) { return { on: p.on, home: p.home, saver: p.saver }; }
    eq(flags(r.data.photos[0]), { on: true, home: true, saver: true });
    eq(flags(svc.devState().photos[0]), { on: true, home: true, saver: true });
    eq(flags(r.data.bundled[0]), { on: true, home: true, saver: true });
    const upload = await request('POST', '/api/photos', fs.readFileSync(path.join(appDir, 'wallpapers', bundled)), { 'content-type': 'image/jpeg' });
    eq(upload.status, 201);
    eq(flags(upload.data.photo), { on: true, home: true, saver: true });
    for (const target of ['photos/' + orphan, 'bundled/' + bundled]) {
      const url = '/api/' + target;
      eq((await request('PATCH', url, { on: false }, { 'x-gh': '' })).status, 403);
      eq((await request('PATCH', url, { on: false }, { origin: 'http://evil.example' })).status, 403);
      const rev = svc.devState().rev;
      eq((await request('PATCH', url, { on: false, home: true, saver: false })).status, 200);
      eq(svc.devState().rev, rev + 1);
      for (const body of [{}, { on: 0 }, { home: 'false' }, { saver: null }, { on: false, extra: true }, JSON.parse('{"__proto__":{"on":false}}')]) {
        eq((await request('PATCH', url, body)).status, 400);
      }
      eq((await request('PATCH', url, { on: 'x'.repeat(300) })).status, 413);
      eq(svc.devState().rev, rev + 1); // rejected writes neither mutate nor bump
    }
    r = await request('GET', '/api/photos');
    eq(flags(r.data.photos.find(p => p.id === orphan)), { on: false, home: true, saver: false });
    eq(flags(r.data.bundled[0]), { on: false, home: true, saver: false });
    eq(flags(svc.devState().photos.find(p => p.id === orphan)), { on: false, home: true, saver: false });
    eq(svc.devState().bundled[bundled], { on: false, home: true, saver: false });
    // The phone's single-checkbox PATCH preserves the other gates, reaches
    // both projections, and bumps rev even when Show is off.
    for (const target of ['photos/' + orphan, 'bundled/' + bundled]) {
      for (const saver of [true, false]) {
        const rev = svc.devState().rev;
        const patched = await request('PATCH', '/api/' + target, { saver });
        const expected = { on: false, home: true, saver };
        eq(patched.status, 200);
        eq(patched.data.flags, expected);
        eq(svc.devState().rev, rev + 1);
        const phone = (await request('GET', '/api/photos')).data;
        const tv = (await request('GET', '/local/state?k=' + svc.localKey())).data;
        eq(flags(target.indexOf('photos/') === 0 ? phone.photos.find(p => p.id === orphan) : phone.bundled[0]), expected);
        eq(flags(target.indexOf('photos/') === 0 ? tv.photos.find(p => p.id === orphan) : tv.bundled[bundled]), expected);
      }
    }
    for (const key of ['__proto__', 'constructor', 'prototype', 'unknown.jpg']) {
      eq((await request('PATCH', '/api/bundled/' + key, { on: false })).status, 404);
      eq((await request('GET', '/media/bundled/' + key)).status, 404);
    }
    eq((await request('GET', '/media/bundled/%2e%2e%2fstate.json')).status, 400);
    eq((await request('GET', '/media/bundled/' + bundled, undefined, { cookie: '' })).status, 401);
    r = await request('GET', '/media/bundled/' + bundled);
    eq(r.status, 200);
    assert(r.raw.equals(fs.readFileSync(path.join(appDir, 'wallpapers', bundled)))); checks++;
    const local = '/local/state?k=' + svc.localKey();
    r = await request('GET', local);
    eq(r.data.bundled[bundled], { on: false, home: true, saver: false });
    eq((await request('GET', local + '&rev=' + r.data.rev)).data.same, true);
    await new Promise(resolve => svc.stop(resolve));
    await start();
    r = await request('GET', '/api/photos');
    eq(r.status, 200); // session also survived restart
    eq(flags(r.data.bundled[0]), { on: false, home: true, saver: false });
    eq(flags(r.data.photos.find(p => p.id === orphan)), { on: false, home: true, saver: false });
    eq(JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'))).v, 1);
    console.log(checks + ' photo API checks, 0 failed');
  } finally {
    if (svc) await new Promise(resolve => svc.stop(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
