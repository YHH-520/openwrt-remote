/* 判定实验：把 ttyd 的渲染器从 webgl 强制切成 dom，再截图对比。
   理由：如果 WebGL 那条路在这台 Exynos 机器上只是「合成不出来」，
   切到 DOM 渲染器后页面里就会出现真实 DOM 文本节点，截图也就有字了。
   注入方式用 CDP 的 addScriptToEvaluateOnNewDocument —— 它在页面自身脚本
   之前执行，能拦住 ttyd 的 WebSocket 回调。

   拦的是 ttyd 协议里的 '2' 号消息（偏好设置）：
     case "2": this.applyPreferences({...clientOptions, ...JSON.parse(r)})
   服务端发的是空的 "2{ }"，所以我们在里面塞一个 rendererType。 */
const http = require('http');
const fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const ROOT = (process.env.OWR_ROOT || process.cwd());
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PATCH = `(function(){
  var _add = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function(type, fn, opt){
    if (type !== 'message' || typeof fn !== 'function') return _add.call(this, type, fn, opt);
    var wrapped = function(ev){
      try {
        var d = ev.data;
        if (d && d.byteLength !== undefined) {
          var b = new Uint8Array(d.buffer || d);
          if (b[0] === 0x32) {                                  /* '2' = 偏好设置 */
            var obj = JSON.parse(new TextDecoder().decode(b.subarray(1)));
            obj.rendererType = 'dom';                            /* 强制 DOM 渲染器 */
            var nb = new TextEncoder().encode(JSON.stringify(obj));
            var out = new Uint8Array(nb.length + 1);
            out[0] = 0x32; out.set(nb, 1);
            console.log('[owr] preferences rewritten ->', obj.rendererType);
            return fn.call(this, new MessageEvent('message', { data: out.buffer }));
          }
        }
      } catch (e) { console.log('[owr] patch err ' + e.message); }
      return fn.call(this, ev);
    };
    return _add.call(this, type, wrapped, opt);
  };
  console.log('[owr] ttyd renderer patch installed');
})();`;

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false });
    const pend = new Map(); let id = 0; const ls = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else ls.forEach(f => f(m));
    });
    ws.once('error', reject);
    ws.once('open', () => resolve({
      send: (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: f => ls.push(f), close: () => ws.close(),
    }));
  });
}
async function ev(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : r;
}
const READ = `JSON.stringify((()=>{const b=window.term.buffer.active;const o=[];for(let i=0;i<b.length;i++){const l=b.getLine(i);if(l)o.push(l.translateToString(true));}
var el=document.querySelector('.xterm-rows');
return {lines:o.filter(s=>s.length), canvases:document.querySelectorAll('canvas').length, rowsNode:!!el, rowsText: el?el.innerText.slice(0,160):null};})())`;

(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('7681'));
  if (!t) { console.log('没有 7681 目标，请先 App.openWebPage 打开终端'); process.exit(1); }
  const c = await connect(t.webSocketDebuggerUrl);
  const logs = [];
  c.on(m => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push('[c.' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('[EXC] ' + ((m.params.exceptionDetails.exception || {}).description || ''));
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  console.log('--- 注入前 ---');
  console.log(await ev(c, READ));
  const b1 = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (b1.result && b1.result.data) { fs.writeFileSync(ROOT + '/build/shots/ttyd-before-webgl.png', Buffer.from(b1.result.data, 'base64')); console.log('shot before ->', fs.statSync(ROOT + '/build/shots/ttyd-before-webgl.png').size, 'B'); }

  const r = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PATCH });
  console.log('\n注入脚本 id =', r.result && r.result.identifier);

  await c.send('Page.reload', { ignoreCache: false });
  await sleep(7000);

  console.log('\n--- 注入后（重载完成） ---');
  console.log(await ev(c, READ));
  console.log('\n--- 控制台 ---');
  console.log(logs.join('\n'));

  const b2 = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (b2.result && b2.result.data) {
    const f = ROOT + '/build/shots/ttyd-after-dom.png';
    fs.writeFileSync(f, Buffer.from(b2.result.data, 'base64'));
    console.log('\nshot after ->', f, fs.statSync(f).size, 'B');
  }
  c.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
