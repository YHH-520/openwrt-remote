/* 给 Store.save 装个探针：一旦 连接列表 从「有」被写成「空」，
   就把调用栈记下来 —— 这样不用猜是谁删的。 */
const http = require('http');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const getJSON = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9222, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
});
(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once('open', r));
  async function ev(expr) {
    return new Promise(res => {
      const id = Math.floor(Math.random() * 1e6);
      const h = raw => { const m = JSON.parse(raw.toString()); if (m.id === id) { ws.off('message', h); res(m.result && m.result.result ? m.result.result.value : m); } };
      ws.on('message', h);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    });
  }
  const before = await ev(`JSON.stringify({ n: (Store.data.connections||[]).length, raw: localStorage.getItem('owr_settings_v1') })`);
  console.log('装探针前的状态:', before);

  await ev(`(function(){
    if (window.__traced) return 'already';
    window.__traced = true; window.__trace = [];
    var orig = Store.save.bind(Store);
    Store.save = function(){
      try {
        var n = (Store.data.connections || []).length;
        if (n === 0 && window.__lastN > 0) {
          window.__trace.push({ when: new Date().toISOString(), stack: (new Error('connections 被清空')).stack });
        }
        window.__lastN = n;
      } catch (e) {}
      return orig();
    };
    // 顺便把两个「会删东西」的入口也记一笔
    ['delConn','clearData'].forEach(function(k){
      var f = App[k].bind(App);
      App[k] = function(){ window.__trace.push({ called: k, stack: (new Error(k)).stack }); return f.apply(null, arguments); };
    });
    return 'hooked';
  })()`);

  // 把连接写回去，然后观察
  console.log('写回连接:', await ev(`(function(){
    Store.data.connections=[{id:'c1',name:'家里软路由',url:'http://192.168.1.1'}];
    Store.data.activeConnectionId='c1'; Store.save(); window.__lastN=1;
    return JSON.stringify({n:Store.data.connections.length});
  })()`));
  console.log('等待 25 秒观察（如果你在动手机，这里就能抓到是谁删的）...');
  await new Promise(r => setTimeout(r, 25000));
  console.log('25 秒后:', await ev(`JSON.stringify({
    conns: (Store.data.connections||[]).length,
    active: Store.active ? Store.active.url : null,
    phase: App.state.phase,
    session: !!Ubus.session,
    trace: window.__trace
  })`));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
