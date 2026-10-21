#!/usr/bin/env node
// Glass Home - dev runner (Mac only, Node 22).
//
// Runs the real service code (app/service/server.js) on 127.0.0.1 and ::1 with
// a throwaway data directory, plus a static server for the TV app so the whole
// thing can be used in a desktop browser. Nothing listens on the LAN.
//
//   node dev/run.js                 service on :18090, TV app on :18091
//   node dev/run.js --demo          also adds demo photos and shortcuts
//   node dev/run.js --keep          keep the data directory on exit
//   node dev/run.js --data DIR      use DIR as the data directory
//   node dev/run.js --no-fetch      no outbound fetches (icons, YouTube titles)
//   node dev/run.js --tv-apps FILE  use the TV's real apps and icons (JSON of {id, name, show, icon})
//   node dev/run.js --max-total-bytes N   storage cap for photos and thumbnails
//                                   (default 500 MB; dev/test-api.sh sets a small one)
//
// TV app:   http://127.0.0.1:18091/index.html?preview=1
// Website:  http://127.0.0.1:18090/
// Signed-in website for screenshots: http://127.0.0.1:18091/dev/login?to=/%23photos
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };

// Each checkout makes its own key for the app <-> service local channel.
if (!fs.existsSync(path.join(APP, 'js', 'local-key.js'))) {
  require('child_process').execFileSync('sh', [path.join(__dirname, 'new-local-key.sh')], { stdio: 'inherit' });
}

const port = Number(opt('--port', 18090));
const uiPort = Number(opt('--ui-port', 18091));
const quiet = flag('--quiet');
const tvApps = opt('--tv-apps', null);
const tvMock = tvApps ? 'window.GH_MOCK = ' + JSON.stringify({
  apps: JSON.parse(fs.readFileSync(tvApps, 'utf8')).filter((a) => a.show !== false)
    .map((a) => ({ id: a.id, name: a.name, iconPath: a.icon }))
}) + ';' : null;
let dataDir = opt('--data', null);
const tempData = !dataDir;
if (!dataDir) dataDir = path.join(__dirname, 'tmp', 'run-' + Date.now() + '-' + process.pid);
fs.mkdirSync(dataDir, { recursive: true });

const log = (...a) => { if (!quiet) console.log('[service]', ...a); };
const config = {};
if (flag('--no-fetch')) config.fetchIcons = false;
if (opt('--max-total-bytes', null)) config.maxTotalBytes = Number(opt('--max-total-bytes'));
const core = require(path.join(APP, 'service', 'server.js'));
const svc = core.createService({
  appDir: APP,
  dataDir,
  port,
  hosts: ['127.0.0.1', '::1'],
  advertiseUrl: 'http://127.0.0.1:' + port,
  config,
  log
});

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.xml': 'text/xml; charset=utf-8', '.webp': 'image/webp', '.ico': 'image/x-icon'
};

function sendFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

// Static files from a base directory; refuses anything outside it.
function serveFrom(base, rel, res) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch (e) { res.writeHead(400); return res.end('bad path'); }
  if (decoded.includes('\0')) { res.writeHead(400); return res.end('bad path'); }
  const file = path.resolve(base, '.' + path.posix.normalize('/' + decoded));
  if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  sendFile(res, file);
}

const ui = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (u.pathname === '/dev/mock.js') {
    // --tv-apps FILE: the TV's real app list and icons (from tv-remote/cdp-tv.js apps)
    if (tvMock) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(tvMock); }
    return sendFile(res, path.join(__dirname, 'mock.js'));
  }
  if (u.pathname === '/dev/login') {
    // Dev only: signs this browser in to the website (cookies are per host, not
    // per port, so a cookie set here is sent to the service on :port too).
    const token = svc.devCreateSession();
    const to = (u.searchParams.get('to') || '/').replace(/^\/*/, '/');
    res.writeHead(302, {
      'Set-Cookie': 'gh_sid=' + token + '; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict',
      'Location': 'http://127.0.0.1:' + port + to,
      'Cache-Control': 'no-store'
    });
    return res.end();
  }
  if (u.pathname.startsWith('/preview-assets/')) return serveFrom(path.join(ROOT, 'preview-assets'), u.pathname.slice('/preview-assets'.length), res);
  serveFrom(APP, u.pathname === '/' ? '/index.html' : u.pathname, res);
});

// ---------- demo content through the real API ----------
function call(method, p, body, cookie, type) {
  return new Promise((resolve, reject) => {
    const headers = { 'X-GH': '1', Host: '127.0.0.1:' + port };
    if (cookie) headers.Cookie = cookie;
    let data = null;
    if (body !== undefined) {
      data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      headers['Content-Type'] = type || 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString() || 'null'); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function seedDemo() {
  const st = svc.devState();
  const login = await call('POST', '/api/login', { password: st.password.plain });
  const cookie = String((login.headers['set-cookie'] || [''])[0]).split(';')[0];
  const dir = path.join(ROOT, 'preview-assets');
  const photos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^demo-photo-\d+\.jpg$/.test(f)).sort() : [];
  for (const f of photos) {
    const r = await call('POST', '/api/photos', fs.readFileSync(path.join(dir, f)), cookie, 'image/jpeg');
    const thumb = path.join(dir, f.replace('.jpg', '-thumb.jpg'));
    if (r.status === 201 && fs.existsSync(thumb)) await call('PUT', '/api/photos/' + r.json.photo.id + '/thumb', fs.readFileSync(thumb), cookie, 'image/jpeg');
  }
  const shortcuts = [
    { type: 'web', url: 'en.wikipedia.org/wiki/Television', name: 'Wikipedia' },
    { type: 'web', url: 'https://www.openstreetmap.org/', name: 'Map' },
    { type: 'youtube', url: process.env.GH_DEMO_YT || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', name: '' }
  ];
  for (const s of shortcuts) await call('POST', '/api/shortcuts', s, cookie);
  log('demo content added: ' + photos.length + ' photos, ' + shortcuts.length + ' shortcuts');
}

function shutdown() {
  svc.stop(() => {});
  ui.close();
  if (tempData && !flag('--keep')) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

svc.start(async (err) => {
  if (err) { console.error('service failed to start:', err.message); process.exit(1); }
  ui.listen(uiPort, '127.0.0.1', async () => {
    if (flag('--demo')) { try { await seedDemo(); } catch (e) { console.error('demo seeding failed:', e.message); } }
    const st = svc.devState();
    console.log('');
    console.log('  TV app   http://127.0.0.1:' + uiPort + '/index.html?preview=1');
    console.log('  Website  http://127.0.0.1:' + port + '/   (password: ' + (st.password && st.password.plain) + ')');
    console.log('  Data     ' + dataDir + (tempData && !flag('--keep') ? '  (deleted on exit)' : ''));
    console.log('');
    if (process.send) process.send({ ready: true, port, uiPort, dataDir });
  });
});
