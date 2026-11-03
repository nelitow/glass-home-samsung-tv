#!/usr/bin/env node
// Glass Home - performance check on the real TV, over the web inspector (Node 22).
//
//   node dev/tv-perf.mjs                 relaunch the app in debug mode, then measure
//   node dev/tv-perf.mjs --attach        use an inspector already forwarded to :9222
//   node dev/tv-perf.mjs --css '...'     add a stylesheet first (try an idea live)
//   node dev/tv-perf.mjs --nohold        keep the photo drifting while navigating
//   node dev/tv-perf.mjs --layers        list the biggest compositor layers and why
//
// Reports compositor layers (how many full screens the GPU blends per frame),
// dropped frames while idle and while moving along the dock (Chrome's own
// frame reporter), how long a key press takes to reach the next frame, the
// key handler's time and long tasks. Arrow presses go in through the inspector,
// so the remote's own delay isn't included. The screen must be on with Glass
// Home in front; nothing animates while the app is hidden.
'use strict';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const APP = 'GlassHome1.GlassHome';
const PORT = 9222;
const sdb = path.join(os.homedir(), 'tizen-studio', 'tools', 'sdb');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Home-button remap makes the TV restart Glass Home as soon as it is
// killed, so kill and relaunch-in-debug back to back, and retry the race.
const TV = process.env.TV || (process.env.TV_IP ? process.env.TV_IP + ':26101' : '192.168.16.164:26101');
async function launchDebug() {
  for (let i = 0; i < 5; i++) {
    try {
      execFileSync(sdb, ['connect', TV], { stdio: 'ignore' });
      execFileSync(sdb, ['shell', '0', 'was_kill', APP], { stdio: 'ignore' });
    } catch (e) { await sleep(1000); continue; }
    const out = await new Promise((resolve) => {
      const p = spawn(sdb, ['shell', '0', 'debug', APP]);
      let s = '';
      p.stdout.on('data', (d) => { s += d; });
      const t = setTimeout(() => { p.kill(); resolve(s); }, 30000);
      p.on('close', () => { clearTimeout(t); resolve(s); });
    });
    const m = /port:\s*(\d+)/.exec(out);
    if (m) {
      for (let j = 0; j < 5; j++) {          // sdb often drops right after debug
        try {
          execFileSync(sdb, ['connect', TV], { stdio: 'ignore' });
          execFileSync(sdb, ['forward', '--remove-all'], { stdio: 'ignore' });
          execFileSync(sdb, ['forward', 'tcp:' + PORT, 'tcp:' + m[1]], { stdio: 'ignore' });
          await sleep(4000);
          return;
        } catch (e) { await sleep(1500); }
      }
    }
  }
  throw new Error('could not start the app in debug mode (is Developer Mode on and sdb connected?)');
}

if (!flag('--attach')) await launchDebug();
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
let nextId = 0;
const pending = {};
const traceEvents = [];
let traceDone = null;
let layers = null;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; return; }
  if (d.method === 'Tracing.dataCollected') traceEvents.push(...d.params.value);
  else if (d.method === 'Tracing.tracingComplete' && traceDone) traceDone();
  else if (d.method === 'LayerTree.layerTreeDidChange' && d.params.layers) layers = d.params.layers;
};
await new Promise((r) => { ws.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { pending[++nextId] = r; ws.send(JSON.stringify({ id: nextId, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
async function key(code) {
  const k = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}
const q = (a, p) => (a.length ? +a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(1) : null);

// ---------- device ----------
const dev = await evaluate(`(function(){var g=document.createElement('canvas').getContext('webgl');var d=g&&g.getExtension('WEBGL_debug_renderer_info');
  return {ua:((navigator.userAgent.match(/Tizen [\\d.]+/)||['Tizen ?'])[0])+', Chromium '+((navigator.userAgent.match(/ (\\d+)\\.0\\.\\d+\\.\\d+/)||['','?'])[1]),gpu:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?',cores:navigator.hardwareConcurrency,
  memGB:navigator.deviceMemory,hidden:document.hidden}})()`);
console.log(`TV: ${dev.ua}, ${dev.gpu}, ${dev.cores} cores, ${dev.memGB} GB`);
if (dev.hidden) console.log('!! Glass Home is not on screen (TV off, Art Mode or another app): frame numbers will be empty.');

const css = opt('--css') || '';
await evaluate(`(function(){var s=document.getElementById('perf-css');if(!s){s=document.createElement('style');s.id='perf-css';document.head.appendChild(s);}s.textContent=${JSON.stringify(css)};
  ${flag('--nohold') ? 'GH.Backdrop.prototype.hold=function(){};' : ''}return 1})()`);
await key(38);                      // wakes the screen if the screensaver is on
await sleep(3000);

// ---------- layers ----------
await send('DOM.enable');
await send('LayerTree.enable');
await sleep(2000);
await send('LayerTree.disable');
const drawn = (layers || []).filter((l) => l.drawsContent);
const screens = drawn.reduce((s, l) => s + l.width * l.height, 0) / (1920 * 1080);
console.log(`Layers: ${drawn.length} drawing, ${drawn.filter((l) => l.width * l.height > 1e6).length} of them over 1 Mpx, ${screens.toFixed(1)} screens of pixels`);
if (flag('--layers')) {
  const doc = (await send('DOM.getDocument', { depth: -1 })).result.root;
  const nodes = {};
  (function walk(n) { nodes[n.backendNodeId] = n; (n.children || []).concat(n.pseudoElements || []).forEach(walk); })(doc);
  const name = (n) => {
    if (!n) return '(squashed)';
    const a = {};
    for (let i = 0; i < (n.attributes || []).length; i += 2) a[n.attributes[i]] = n.attributes[i + 1];
    return (n.nodeName || '').toLowerCase() + (a.id ? '#' + a.id : '') + (a.class ? '.' + a.class.split(' ').join('.') : '') + (n.pseudoType ? '::' + n.pseudoType : '');
  };
  const big = drawn.slice().sort((x, y) => y.width * y.height - x.width * x.height).slice(0, 10);
  for (const l of big) {
    const r = await send('LayerTree.compositingReasons', { layerId: l.layerId });
    const why = ((r.result && (r.result.compositingReasonIds || r.result.compositingReasons)) || []).join(', ');
    console.log(`  ${Math.round(l.width)}x${Math.round(l.height)}  ${name(nodes[l.backendNodeId]).slice(0, 44).padEnd(44)} ${why}`);
  }
}

// ---------- frames ----------
async function traced(fn) {
  traceEvents.length = 0;
  await send('Tracing.start', {
    traceConfig: { includedCategories: ['cc', 'viz', 'gpu', 'benchmark', 'devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'blink', 'input'] },
    transferMode: 'ReportEvents'
  });
  await sleep(200);
  await fn();
  await new Promise((r) => { traceDone = r; send('Tracing.end'); });
  const st = {};
  traceEvents.forEach((e) => {
    if (e.name !== 'PipelineReporter' || e.ph !== 'b') return;
    const s = e.args && e.args.chrome_frame_reporter && e.args.chrome_frame_reporter.state;
    if (s) st[s] = (st[s] || 0) + 1;
  });
  const shown = st.STATE_PRESENTED_ALL || 0;
  const dropped = st.STATE_DROPPED || 0;
  const draws = traceEvents.filter((e) => e.name === 'DirectRenderer::DrawFrame').length;
  return { shown, dropped, draws, pct: shown + dropped ? (100 * dropped / (shown + dropped)).toFixed(1) + '%' : '-' };
}
const REC = `(function(){var b=window.__perf={on:true,lat:[],h:[],long:0};
  if(!window.__perfKey){window.__perfKey=1;window.addEventListener('keydown',function(){var p=window.__perf;if(!p||!p.on)return;var t0=performance.now();
    setTimeout(function(){p.h.push(performance.now()-t0)},0);requestAnimationFrame(function(){setTimeout(function(){p.lat.push(performance.now()-t0)},0)})},true);
    try{new PerformanceObserver(function(l){var p=window.__perf;if(p&&p.on)p.long+=l.getEntries().length}).observe({entryTypes:['longtask']})}catch(e){}}
  return 1})()`;
const secs = 4;
const idle = await traced(() => sleep(secs * 1000));
await evaluate(REC);
const presses = +(opt('--presses') || 30);
const gap = +(opt('--gap') || 140);
const nav = await traced(async () => {
  for (let i = 0; i < presses; i++) { await key(Math.floor(i / 5) % 2 ? 37 : 39); await sleep(gap); }
  await sleep(500);
});
const k = await evaluate('(function(){var p=window.__perf;p.on=false;return {lat:p.lat,h:p.h,long:p.long}})()');
console.log(`Idle ${secs}s: ${idle.pct} of frames dropped (${idle.dropped}/${idle.shown + idle.dropped}), ${(idle.draws / secs).toFixed(0)} GPU draws/s`);
console.log(`Navigating (${presses} presses, ${gap} ms apart): ${nav.pct} dropped (${nav.dropped}/${nav.shown + nav.dropped}), ${nav.draws} GPU draws`);
console.log(`Key press to next frame: p50 ${q(k.lat, 0.5)} ms, p90 ${q(k.lat, 0.9)} ms, max ${q(k.lat, 1)} ms; handler p50 ${q(k.h, 0.5)} ms, p90 ${q(k.h, 0.9)} ms; long tasks ${k.long}`);
ws.close();
process.exit(0);
