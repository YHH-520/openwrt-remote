/* 分阶段对照 localStorage 的**原始值**，并装一个跨重启存活的追踪：
   1) 读原始值  2) 写入并立刻回读原始值  3) 强杀重启  4) 再读原始值
   如果第 2 步回读就失败 → 是 save() 没落地；如果第 2 步成功、第 4 步变了 → 是启动路径把它改了。 */
const http = require('http');
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
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'EXC: ' + r.result.exceptionDetails.text;
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const raw = () => ev(`localStorage.getItem('owr_settings_v1')`);
  const connsOf = s => { try { return (JSON.parse(s).connections || []).length; } catch (e) { return 'PARSE_FAIL'; } };

  console.log('[1] 当前原始值:', await raw(), '→ 连接数', connsOf(await raw()));

  console.log('[2] 装持久化追踪并写入连接');
  console.log('    追踪已装:', await ev(`(function(){
    if (window.__pt) return 'already';
    window.__pt = true;
    var log = JSON.parse(localStorage.getItem('__trace') || '[]');
    function push(what, extra){
      log.push({ t: new Date().toISOString(), what: what, extra: extra || '' });
      try { localStorage.setItem('__trace', JSON.stringify(log.slice(-40))); } catch(e){}
    }
    var orig = Store.save.bind(Store);
    Store.save = function(){
      var n = (Store.data.connections || []).length;
      if (n === 0) push('save-with-empty-connections', new Error('x').stack.split('\\n').slice(1,4).join(' <- '));
      return orig();
    };
    ['delConn','clearData','addConn'].forEach(function(k){
      var f = App[k].bind(App);
      App[k] = function(){ push(k + '()'); return f.apply(null, arguments); };
    });
    return 'ok';
  })()`));
  console.log('    写入:', await ev(`(function(){
    Store.data.connections=[{id:'c1',name:'家里软路由',url:'http://192.168.1.1'}];
    Store.data.activeConnectionId='c1'; Store.data.password='${process.env.OWR_PASS||''}'; Store.save();
    return JSON.stringify({ mem: Store.data.connections.length, disk: JSON.parse(localStorage.getItem('owr_settings_v1')).connections.length });
  })()`));

  console.log('[3] 强杀重启');
  await ev('"bye"');
  c.close();
  const { execSync } = require('child_process');
  const ADB = process.env.ADB || 'adb';
  execSync(`${ADB} shell am force-stop com.owr.remote`);
  await sleep(2500);
  execSync(`${ADB} shell am start -n com.owr.remote/.MainActivity`);
  await sleep(9000);
  const pid = execSync(`${ADB} shell pidof com.owr.remote`).toString().trim();
  execSync(`${ADB} forward --remove-all`);
  execSync(`${ADB} forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
  await sleep(1500);
  const t2 = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const c2 = await connect(t2.webSocketDebuggerUrl);
  const ev2 = async e => {
    const r = await c2.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const after = await ev2(`localStorage.getItem('owr_settings_v1')`);
  console.log('[4] 重启后原始值:', after, '→ 连接数', connsOf(after));
  console.log('    追踪记录:', await ev2(`localStorage.getItem('__trace')`));
  console.log('    探针是否还在:', await ev2(`localStorage.getItem('__probe')`));
  c2.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
