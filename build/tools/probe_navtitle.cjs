// 量一下「小标题跟随大标题」的判断依据是否成立
const http = require('http');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once('open', r));
  const expr = `(function(){
    var big = document.querySelector('#view .page-title');
    var nav = document.getElementById('nav');
    var t = document.getElementById('nav-title');
    var o = { phase: App.state.phase, hasSession: !!Ubus.session, scrollY: window.scrollY,
              bigBottom: big ? Math.round(big.getBoundingClientRect().bottom) : null,
              navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
              dim: t.classList.contains('dim') };
    App.syncNavTitle();
    o.dimAfter = t.classList.contains('dim');
    o.opacity = getComputedStyle(t).opacity;
    return JSON.stringify(o);
  })()`;
  const out = await new Promise(res => {
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id === 1) res(m); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });
  console.log(JSON.stringify(out.result && out.result.result && out.result.result.value));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
