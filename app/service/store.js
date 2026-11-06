// Glass Home service - persistent state and files.  Node 12 API only.
//
// <dataDir>/state.json        password hash, sessions (hashed), photos, shortcuts
// <dataDir>/state.json.bak    previous good copy
// <dataDir>/shown.json        the current password, for the TV to show after a restart
// <dataDir>/photos/<id>.jpg   1920x1080 JPEGs uploaded from the phone
// <dataDir>/thumbs/<id>.jpg   small copies for the phone's grid
// <dataDir>/icons/<file>      shortcut icons and YouTube thumbnails
// <dataDir>/cache/<file>      YouTube previews shown on the phone before adding
'use strict';
var fs = require('fs');
var path = require('path');

var PHOTO_ID = /^[a-f0-9]{24}$/;
var SHORTCUT_ID = /^[a-f0-9]{16}$/;
var ICON_FILE = /^[a-f0-9]{16}-[a-f0-9]{8}\.(png|jpg|gif|webp|ico|svg)$/;
var CACHE_FILE = /^yt-[a-f0-9]{16}\.jpg$/;

function mkdirp(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}

function emptyState() {
  return { v: 1, rev: 1, password: null, sessions: [], photos: [], shortcuts: [], bundled: Object.create(null) };
}

// Picks the first candidate directory that can really be written and read back.
function pickDataDir(candidates, log) {
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c || !c.dir) continue;
    try {
      mkdirp(c.dir);
      var probe = path.join(c.dir, '.probe-' + process.pid);
      var token = String(Date.now());
      fs.writeFileSync(probe, token);
      var back = fs.readFileSync(probe, 'utf8');
      fs.unlinkSync(probe);
      if (back === token) return c;
      if (log) log('data dir read-back mismatch: ' + c.dir);
    } catch (e) {
      if (log) log('data dir unusable: ' + c.dir + ' (' + (e.code || e.message) + ')');
    }
  }
  return null;
}

// Only explicit false excludes a picture, including old and orphan records.
function photoFlags(p) {
  p = p || {};
  return { on: p.on !== false, home: p.home !== false, saver: p.saver !== false };
}

function readManifest(appDir) {
  var out = Object.create(null);
  try {
    var list = JSON.parse(fs.readFileSync(path.join(appDir, 'wallpapers', 'manifest.json'), 'utf8'));
    if (Array.isArray(list)) list.forEach(function (w) {
      var f = w && w.file;
      if (typeof f !== 'string' || f === '__proto__' || f === 'constructor' || f === 'prototype') return;
      if (/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpe?g|png|webp)$/i.test(f)) out[f] = w;
    });
  } catch (e) { /* no packaged pictures */ }
  return out;
}

function Store(dir, log, appDir) {
  this.manifest = readManifest(appDir || path.join(__dirname, '..'));
  this.dir = dir;
  this.log = log || function () {};
  this.photosDir = path.join(dir, 'photos');
  this.thumbsDir = path.join(dir, 'thumbs');
  this.iconsDir = path.join(dir, 'icons');
  this.cacheDir = path.join(dir, 'cache');
  this.file = path.join(dir, 'state.json');
  this.state = emptyState();
}

Store.prototype._read = function (file) {
  var data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || data.v !== 1) throw new Error('bad state');
  var s = emptyState();
  s.rev = Number(data.rev) || 1;
  s.password = data.password || null;
  s.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  s.photos = Array.isArray(data.photos) ? data.photos : [];
  s.shortcuts = Array.isArray(data.shortcuts) ? data.shortcuts : [];
  s.bundled = this.bundledFlags(data.bundled);
  return s;
};

// Copy only current manifest keys and named flags; never retain foreign keys.
Store.prototype.bundledFlags = function (source) {
  var out = Object.create(null);
  Object.keys(this.manifest).forEach(function (file) {
    if (source && Object.prototype.hasOwnProperty.call(source, file)) out[file] = photoFlags(source[file]);
  });
  return out;
};

Store.prototype.load = function () {
  [this.dir, this.photosDir, this.thumbsDir, this.iconsDir, this.cacheDir].forEach(mkdirp);
  var loaded = null;
  var files = [this.file, this.file + '.bak'];
  for (var i = 0; i < files.length && !loaded; i++) {
    try { if (fs.existsSync(files[i])) loaded = this._read(files[i]); } catch (e) {
      this.log('state unreadable: ' + files[i] + ' (' + e.message + ')');
    }
  }
  this.state = loaded || emptyState();
  if (this._reconcile()) this.state.rev += 1;
  this.save();
};

// Makes state.json agree with the files on disk after a crash or power cut.
Store.prototype._reconcile = function () {
  var self = this;
  var s = this.state;
  var photoIds = new Set(s.photos.filter(Boolean).map(function (p) { return p.id; }));
  var shortcutIds = new Set(s.shortcuts.filter(Boolean).map(function (x) { return x.id; }));
  s.bundled = this.bundledFlags(s.bundled);
  var onDisk = {};
  safeList(this.photosDir).forEach(function (f) {
    if (/^\.up-/.test(f)) { unlinkQuiet(path.join(self.photosDir, f)); return; }
    var m = /^([a-f0-9]{24})\.jpg$/.exec(f);
    if (m) onDisk[m[1]] = true;
  });
  s.photos = s.photos.filter(function (p) { return p && PHOTO_ID.test(p.id) && onDisk[p.id]; });
  var known = {};
  s.photos.forEach(function (p) { known[p.id] = true; });
  Object.keys(onDisk).forEach(function (id) {
    if (known[id]) return;
    try {
      var st = fs.statSync(path.join(self.photosDir, id + '.jpg'));
      s.photos.push({ id: id, added: st.mtime.getTime(), bytes: st.size, w: 0, h: 0, thumb: false });
    } catch (e) { /* ignore */ }
  });
  s.photos.sort(function (a, b) { return a.added - b.added; });
  var thumbs = {};
  safeList(this.thumbsDir).forEach(function (f) {
    var m = /^([a-f0-9]{24})\.jpg$/.exec(f);
    if (m && onDisk[m[1]]) thumbs[m[1]] = true;
    else unlinkQuiet(path.join(self.thumbsDir, f));
  });
  s.photos.forEach(function (p) { p.thumb = !!thumbs[p.id]; });

  s.shortcuts = s.shortcuts.filter(function (x) { return x && SHORTCUT_ID.test(x.id); });
  var icons = {};
  s.shortcuts.forEach(function (x) {
    if (x.icon && !(ICON_FILE.test(x.icon) && fs.existsSync(path.join(self.iconsDir, x.icon)))) x.icon = null;
    if (x.icon) icons[x.icon] = true;
    if (x.iconState === 'pending') x.iconState = 'retry';
  });
  safeList(this.iconsDir).forEach(function (f) { if (!icons[f]) unlinkQuiet(path.join(self.iconsDir, f)); });
  safeList(this.cacheDir).forEach(function (f) { unlinkQuiet(path.join(self.cacheDir, f)); });

  var now = Date.now();
  s.sessions = s.sessions.filter(function (x) { return x && x.h && x.expires > now; });
  return photoIds.size !== new Set(s.photos.map(function (p) { return p.id; })).size ||
    shortcutIds.size !== new Set(s.shortcuts.map(function (x) { return x.id; })).size ||
    s.photos.some(function (p) { return !photoIds.has(p.id); }) ||
    s.shortcuts.some(function (x) { return !shortcutIds.has(x.id); });
};

Store.prototype.save = function () {
  var tmp = this.file + '.tmp';
  var data = JSON.stringify(this.state);
  var fd = fs.openSync(tmp, 'w', 384);   // 0600
  try {
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch (e) { /* not fatal */ }
  } finally {
    fs.closeSync(fd);
  }
  try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak'); } catch (e) { /* keep going */ }
  fs.renameSync(tmp, this.file);
};

// The current password, kept apart from state.json (which holds only its hash)
// so the TV can still show it after the service restarts (a power cut, say).
// Same protection as state.json: app-private folder, mode 0600, atomic rename.
Store.prototype.readShown = function () {
  try {
    var d = JSON.parse(fs.readFileSync(path.join(this.dir, 'shown.json'), 'utf8'));
    if (d && typeof d.id === 'string' && typeof d.value === 'string' && d.value.length <= 200) {
      return { id: d.id, value: d.value };
    }
  } catch (e) { /* none yet */ }
  return null;
};

Store.prototype.writeShown = function (rec) {
  var file = path.join(this.dir, 'shown.json');
  var tmp = file + '.tmp';
  try {
    var fd = fs.openSync(tmp, 'w', 384);   // 0600
    try {
      fs.writeSync(fd, JSON.stringify({ id: rec.id, value: rec.value }));
      try { fs.fsyncSync(fd); } catch (e) { /* not fatal */ }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    this.log('could not keep the password for display: ' + e.message);
  }
};

Store.prototype.bump = function () {
  this.state.rev += 1;
  this.save();
};

Store.prototype.photoPath = function (id) {
  if (!PHOTO_ID.test(id)) throw new Error('bad id');
  return path.join(this.photosDir, id + '.jpg');
};

Store.prototype.thumbPath = function (id) {
  if (!PHOTO_ID.test(id)) throw new Error('bad id');
  return path.join(this.thumbsDir, id + '.jpg');
};

Store.prototype.iconPath = function (file) {
  if (!ICON_FILE.test(file)) throw new Error('bad icon');
  return path.join(this.iconsDir, file);
};

Store.prototype.cachePath = function (file) {
  if (!CACHE_FILE.test(file)) throw new Error('bad cache file');
  return path.join(this.cacheDir, file);
};

Store.prototype.findPhoto = function (id) {
  for (var i = 0; i < this.state.photos.length; i++) if (this.state.photos[i].id === id) return this.state.photos[i];
  return null;
};

Store.prototype.totalBytes = function () {
  var n = 0;
  this.state.photos.forEach(function (p) { n += (p.bytes || 0) + (p.thumbBytes || 0); });
  return n;
};

Store.prototype.removePhoto = function (id) {
  var before = this.state.photos.length;
  this.state.photos = this.state.photos.filter(function (p) { return p.id !== id; });
  if (this.state.photos.length === before) return false;
  unlinkQuiet(this.photoPath(id));
  unlinkQuiet(this.thumbPath(id));
  this.bump();
  return true;
};

Store.prototype.findShortcut = function (id) {
  for (var i = 0; i < this.state.shortcuts.length; i++) if (this.state.shortcuts[i].id === id) return this.state.shortcuts[i];
  return null;
};

Store.prototype.removeShortcut = function (id) {
  var sc = this.findShortcut(id);
  if (!sc) return false;
  this.state.shortcuts = this.state.shortcuts.filter(function (x) { return x.id !== id; });
  if (sc.icon) unlinkQuiet(this.iconPath(sc.icon));
  this.bump();
  return true;
};

// ids: the new order. Unknown ids are ignored; shortcuts not named keep their
// relative order after the named ones.
Store.prototype.reorderShortcuts = function (ids) {
  var byId = {};
  this.state.shortcuts.forEach(function (x) { byId[x.id] = x; });
  var out = [];
  var seen = {};
  (ids || []).forEach(function (id) {
    if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = true; }
  });
  this.state.shortcuts.forEach(function (x) { if (!seen[x.id]) out.push(x); });
  this.state.shortcuts = out;
  this.bump();
};

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

function unlinkQuiet(file) {
  try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
}

module.exports = {
  Store: Store,
  photoFlags: photoFlags,
  pickDataDir: pickDataDir,
  mkdirp: mkdirp,
  unlinkQuiet: unlinkQuiet,
  PHOTO_ID: PHOTO_ID,
  SHORTCUT_ID: SHORTCUT_ID,
  ICON_FILE: ICON_FILE,
  CACHE_FILE: CACHE_FILE
};
