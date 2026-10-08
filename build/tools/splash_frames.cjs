/* 把图标拼装动画逐帧抓下来。
   adb screencap 一次要 500ms 上下，抓不到 1 秒出头的动画；改走 CDP 截屏（延迟小得多）。
   为了不被「动画播完就退场」赶着走，先在文档开始前注入一段轮询把 splashMin 拉长，
   这样动画只播一遍、播完停住，就能慢慢取帧。 */
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
  // 慢放 10 倍：真实时长只有 1 秒出头，而 captureScreenshot 一次就要几百毫秒，
  // 按真实节奏取帧根本落不到动画中间。所有时长/延迟同步放大 10 倍后，
  // 每一帧都能稳稳落在拼装过程的某一刻。
  const CSS = [
    '.sp-logo{animation-duration:5s!important}',
    '.spg-left{animation-duration:6.2s!important;animation-delay:0.6s!important}',
    '.spg-right{animation-duration:7.4s!important;animation-delay:1.2s!important}',
    '.sp-arc{animation-duration:3.6s!important;animation-delay:6.2s!important}',
    '.spd-1{animation-duration:3s!important;animation-delay:6.6s!important}',
    '.spd-2{animation-duration:3s!important;animation-delay:7.3s!important}',
    '.spd-3{animation-duration:3s!important;animation-delay:8s!important}',
    '.sp-name{animation-duration:5s!important;animation-delay:7s!important}',
    '.sp-sub{animation-duration:5s!important;animation-delay:7.9s!important}',
    '.sp-track{animation-duration:5s!important;animation-delay:8.6s!important}'
  ].join('');
  await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: '(function(){'
      + 'var n=0,t=setInterval(function(){try{if(typeof App!=="undefined"){App.splashMin=60000;clearInterval(t);}}catch(e){}if(++n>3000)clearInterval(t);},2);'
      + 'function put(){if(!document.documentElement)return setTimeout(put,5);'
      + 'var s=document.createElement("style");s.textContent=' + JSON.stringify(CSS) + ';'
      + '(document.head||document.documentElement).appendChild(s);}put();'
      + '})();'
  });
  await c.send('Page.reload', { ignoreCache: true });
  const at = [2000, 4000, 6000, 7500, 9000, 11000, 13000];
  let prev = 0;
  for (let i = 0; i < at.length; i++) {
    await sleep(at[i] - prev); prev = at[i];
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) {
      const f = 'build/shots/v112-sp' + (i + 1) + '-' + at[i] + 'ms.png';
      fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
      console.log(f);
    }
  }
  c.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
