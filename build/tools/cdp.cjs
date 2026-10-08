// CDP helper for Android WebView debugging (CommonJS: ESM triggers undici WASM OOM in this sandbox).
// Usage:
//   node cdp.cjs list
//   node cdp.cjs eval "<js expression>"
//   node cdp.cjs shot <out.png>
//   node cdp.cjs eval-shot <out.png> "<js expression>"
const http = require('http');
const fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));

const PORT = process.env.CDP_PORT || 9222;
// CDP_MATCH：当进程里有多个 WebView（主界面 + LuciActivity 打开的路由器页面）时，
// 用 URL 子串指定要连哪个。默认仍是主界面 index.html。
const MATCH = process.env.CDP_MATCH || 'index.html';
const [cmd, ...rest] = process.argv.slice(2);

function getJSON(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pend = new Map();
    let id = 0;
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    ws.once('error', reject);
    ws.once('open', () => resolve({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close(),
    }));
  });
}

(async () => {
  const targets = await getJSON('/json');
  const page = targets.find(t => (t.url || '').includes(MATCH)) || targets.find(t => t.type === 'page');
  if (cmd === 'list' || !page) {
    console.log(JSON.stringify(targets.map(t => ({ title: t.title, url: t.url, type: t.type })), null, 1));
    process.exit(0);
  }
  const c = await connect(page.webSocketDebuggerUrl);

  async function evaluate(expr) {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text, detail: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
    return r.result && r.result.result ? r.result.result.value : r;
  }
  async function shot(file) {
    const r = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    if (!r.result || !r.result.data) return { __error: JSON.stringify(r).slice(0, 300) };
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return { saved: file, bytes: fs.statSync(file).size };
  }

  let out;
  if (cmd === 'eval') out = await evaluate(rest.join(' '));
  else if (cmd === 'shot') out = await shot(rest[0]);
  else if (cmd === 'eval-shot') { out = await evaluate(rest.slice(1).join(' ')); console.log('EVAL:', typeof out === 'string' ? out : JSON.stringify(out)); out = await shot(rest[0]); }
  else out = { __error: 'unknown cmd: ' + cmd };

  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
  c.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
