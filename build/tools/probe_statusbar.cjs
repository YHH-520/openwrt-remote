/* 顶部状态条为什么没显示 —— 把 updateStatus 的判断条件逐项量出来 */
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
    var bar = document.getElementById('nav-status');
    var nav = document.getElementById('nav');
    var o = {
      hasBar: !!bar,
      barClass: bar ? bar.className : null,
      barRect: bar ? JSON.stringify(bar.getBoundingClientRect()) : null,
      barDisplay: bar ? getComputedStyle(bar).display : null,
      navRect: nav ? [Math.round(nav.getBoundingClientRect().top), Math.round(nav.getBoundingClientRect().bottom)] : null,
      navClass: nav ? nav.className : null,
      phase: App.state.phase,
      hasSession: !!Ubus.session,
      activeUrl: Store.active ? Store.active.url : null,
      envTop: getComputedStyle(document.documentElement).getPropertyValue('--x') || 'n/a',
      nsLeft: document.getElementById('ns-left') ? document.getElementById('ns-left').textContent : 'no el',
      nsRight: document.getElementById('ns-right') ? document.getElementById('ns-right').textContent : 'no el',
      hostname: App.state.hostname
    };
    App.updateStatus();
    o.barClassAfter = bar ? bar.className : null;
    o.barRectAfter = bar ? JSON.stringify(bar.getBoundingClientRect()) : null;
    o.nsLeftAfter = document.getElementById('ns-left').textContent;
    o.navRectAfter = [Math.round(nav.getBoundingClientRect().top), Math.round(nav.getBoundingClientRect().bottom)];
    return JSON.stringify(o);
  })()`;
  const out = await new Promise(res => {
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id === 1) res(m); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });
  console.log(out.result && out.result.result && out.result.result.value);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
