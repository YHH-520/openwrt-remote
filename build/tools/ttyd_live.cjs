/* 在真机上打开 ttyd 页面，并用 CDP 读取它自己的控制台输出。
   目的：确认「白板终端」到底卡在哪一步 ——
     [ttyd] websocket connection opened   → 连接层 OK
     [ttyd] WebGL renderer loaded         → 渲染层 OK
   两者缺哪一个，问题就在哪一层。 */
const http = require('http');
const fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const ROOT = (process.env.OWR_ROOT || process.cwd());
const PORT = 9222;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pend = new Map(); let id = 0; const listeners = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
      else listeners.forEach(f => f(m));
    });
    ws.once('error', reject);
    ws.once('open', () => resolve({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: f => listeners.push(f),
      close: () => ws.close(),
    }));
  });
}
async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text, detail: (r.result.exceptionDetails.exception || {}).description };
  return r.result && r.result.result ? r.result.result.value : r;
}

(async () => {
  // ---- 1. 驱动主 WebView 打开终端页 ----
  let targets = await getJSON('/json');
  console.log('targets:', targets.map(t => t.url).join('\n         '));
  const main = targets.find(t => (t.url || '').includes('index.html'));
  if (!main) { console.log('找不到主 WebView'); process.exit(1); }
  const mc = await connect(main.webSocketDebuggerUrl);
  console.log('触发 openWebPage(ttyd) ->', await evaluate(mc,
    "(()=>{try{App.openWebPage({url:'http://192.168.1.1:7681/',title:'终端'});return 'ok'}catch(e){return 'ERR '+e.message}})()"));
  mc.close();

  await sleep(7000);

  // ---- 2. 找到终端页的 target ----
  targets = await getJSON('/json');
  console.log('\n--- 所有 target ---');
  targets.forEach(t => console.log('  [' + t.type + '] ' + t.title + ' :: ' + (t.url || '').slice(0, 90)));
  const tty = targets.find(t => (t.url || '').includes('7681'));
  if (!tty) { console.log('\n没有找到 7681 的页面 target'); process.exit(2); }

  const c = await connect(tty.webSocketDebuggerUrl);
  const logs = [];
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    } else if (m.method === 'Log.entryAdded') {
      logs.push('[log.' + m.params.entry.level + '] ' + m.params.entry.text);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception || {}).description);
    }
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  await sleep(1200);

  console.log('\n--- ttyd 自己的控制台 ---');
  console.log(logs.length ? logs.join('\n') : '(空)');

  // ---- 3. 现场取证：DOM / 渲染器 / WebGL ----
  const probe = await evaluate(c, `JSON.stringify((()=>{
    const q=s=>document.querySelector(s);
    const cv=document.querySelectorAll('canvas');
    let gl=null,glErr='';
    try{const t=document.createElement('canvas');gl=t.getContext('webgl2')||t.getContext('webgl');}catch(e){glErr=e.message}
    return {
      title: document.title,
      readyState: document.readyState,
      xtermExists: !!q('.xterm'),
      screen: q('.xterm-screen') ? {w:q('.xterm-screen').clientWidth,h:q('.xterm-screen').clientHeight} : null,
      rowsText: q('.xterm-rows') ? q('.xterm-rows').innerText.slice(0,200) : null,
      canvases: cv.length,
      canvasSizes: [...cv].map(x=>x.width+'x'+x.height),
      canvasVisible: [...cv].map(x=>{const s=getComputedStyle(x);return s.display+'/'+s.visibility+'/'+s.opacity}),
      termGlobal: typeof window.term,
      termCols: window.term ? window.term.cols : null,
      bodyText: document.body.innerText.replace(/\\n+/g,' | ').slice(0,200),
      webglOk: !!gl, webglErr: glErr,
      ua: navigator.userAgent,
      knownGlobal: Object.keys(window).filter(k=>/term|ttyd/i.test(k)).slice(0,10)
    };
  })())`);
  console.log('\n--- 页面现场 ---');
  try { console.log(JSON.stringify(JSON.parse(probe), null, 1)); } catch (e) { console.log(probe); }

  const r = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (r.result && r.result.data) {
    const f = ROOT + '/build/shots/ttyd-live.png';
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log('\nscreenshot ->', f, fs.statSync(f).size, 'B');
  }
  c.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
