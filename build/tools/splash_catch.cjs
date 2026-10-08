/* 抓启动动画那几帧。
   adb screencap 一次要 500ms 上下，而网页启动动画只播 1.4 秒，
   等它返回时早就进主界面了 —— 所以改走 CDP 自己的截图，
   延迟只有一两百毫秒，再密集轮询就能落在动画中间。 */
const http = require('http');
const fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pend = new Map(); let id = 0;
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    });
    ws.once('error', reject);
    ws.once('open', () => resolve({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => ws.close()
    }));
  });
}

(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Page.enable');
  // 让启动动画多播一会儿，好让下面的轮询一定落在动画中间
  await c.send('Runtime.evaluate', { expression: 'App.splashMin = 6000; "ok"', returnByValue: true });
  await c.send('Page.reload', { ignoreCache: true });
  for (let i = 1; i <= 8; i++) {
    await sleep(i === 1 ? 500 : 260);
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const d = r.result && r.result.data;
    if (d) { fs.writeFileSync('build/shots/v111-anim' + i + '.png', Buffer.from(d, 'base64')); console.log('anim' + i + '.png', Math.round(d.length * 0.75 / 1024) + 'KB'); }
  }
  c.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
