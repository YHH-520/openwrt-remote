const http = require('http');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once('open', r));
  const expr = `JSON.stringify({
    raw: localStorage.getItem('owr_settings_v1'),
    parsedConnCount: (JSON.parse(localStorage.getItem('owr_settings_v1')||'{}').connections||[]).length,
    phase: App.state.phase,
    pageTitle: document.querySelector('#view .page-title') ? document.querySelector('#view .page-title').textContent : null,
    viewHead: document.getElementById('view').innerText.slice(0, 60).replace(/\\n/g, ' | ')
  })`;
  const out = await new Promise(res => {
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id === 1) res(m); });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  });
  console.log(out.result && out.result.result && out.result.result.value);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
