/* 把启动动画「按住」再截图，纯粹为了留一张能看清的图。
   办法：在文档开始执行前注入一段轮询，等 window.App 一出现就把 splashMin 拉长，
   这样 boot() 走到 hideSplash 时读到的就是长值。
   只影响这一次会话，不动源码。 */
const http = require('http');
const fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pend = new Map(); let id = 0;
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
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
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(function(){var n=0,t=setInterval(function(){try{if(typeof App!=="undefined"){App.splashMin=30000;clearInterval(t);}}catch(e){}if(++n>2000)clearInterval(t);},5);})();'
  });
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  if (r.result && r.result.data) {
    fs.writeFileSync('build/shots/v111-splash-full.png', Buffer.from(r.result.data, 'base64'));
    console.log('saved v111-splash-full.png');
  }
  c.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
