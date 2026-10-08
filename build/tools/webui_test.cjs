/* 验证「路由器页面」内嵌覆盖层：
   1) 打开功能区，确认菜单渲染出来
   2) 打开一个 LuCI 页面，确认覆盖层出现、顶部标题栏和底部 Tab 栏还在
   3) 记录覆盖层的上下留白，判断是否正好卡在标题栏与底栏之间
   4) 再打开第二个页面，验证缓存（第二次不应重新加载） */
const http = require('http'), fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const ROOT = (process.env.OWR_ROOT || process.cwd());
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    const pend = new Map(); let id = 0;
    ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
    ws.once('error', reject);
    ws.once('open', () => resolve({ send: (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }), close: () => ws.close() }));
  });
}
async function ev(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result && r.result.result ? r.result.result.value : r;
}
async function shot(c, name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (!r.result || !r.result.data) return 'fail';
  const f = ROOT + '/build/shots/' + name;
  fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  return fs.statSync(f).size + 'B';
}

(async () => {
  const t = (await getJSON('/json')).find(x => (x.url || '').includes('index.html'));
  const c = await connect(t.webSocketDebuggerUrl);

  console.log('--- 1. 功能区 ---');
  await ev(c, 'App.setTab("menu")');
  await sleep(2500);
  console.log('  行数:', await ev(c, 'document.querySelectorAll("#view .cell").length'));
  console.log('  shot:', await shot(c, 'v110-menu.png'));

  console.log('\n--- 2. 打开「状态」组 ---');
  await ev(c, 'App.openSub("luci:status","状态")');
  await sleep(700);
  console.log('  行数:', await ev(c, 'document.querySelectorAll("#view .cell").length'));
  console.log('  shot:', await shot(c, 'v110-luci-status.png'));

  console.log('\n--- 3. 内嵌打开 LuCI 概况页 ---');
  await ev(c, 'App.openWebPage({id:"/cgi-bin/luci/admin/status/overview",path:"/cgi-bin/luci/admin/status/overview",title:"概况"})');
  await sleep(6000);
  console.log(' ' + JSON.stringify(await ev(c, `JSON.stringify((()=>{
    const nav=document.getElementById('nav').getBoundingClientRect();
    const tab=document.getElementById('tabbar').getBoundingClientRect();
    return {
      webPage: App.state.webPage && App.state.webPage.title,
      navBottom: Math.round(nav.bottom), tabTop: Math.round(tab.top),
      innerH: window.innerHeight, dpr: window.devicePixelRatio,
      navHidden: document.getElementById('nav').classList.contains('hidden'),
      tabHidden: document.getElementById('tabbar').classList.contains('hidden'),
      backVisible: !document.getElementById('nav-back').classList.contains('hidden'),
      actionVisible: !document.getElementById('nav-action').classList.contains('placeholder'),
      navTitle: document.getElementById('nav-title').textContent,
      viewLen: document.getElementById('view').innerHTML.length
    }})())`)));
  console.log('  shot:', await shot(c, 'v110-web-overview.png'));

  console.log('\n--- 4. 再开一个页面（验证缓存与切换） ---');
  await ev(c, 'App.openWebPage({id:"/cgi-bin/luci/admin/network/wireless",path:"/cgi-bin/luci/admin/network/wireless",title:"无线"})');
  await sleep(6000);
  console.log('  shot:', await shot(c, 'v110-web-wireless.png'));
  console.log('  navTitle:', await ev(c, 'document.getElementById("nav-title").textContent'));

  console.log('\n--- 5. 切回 Tab，覆盖层应自动收起 ---');
  await ev(c, 'App.setTab("overview")');
  await sleep(800);
  console.log('  webPage:', await ev(c, 'String(App.state.webPage)'));
  console.log('  viewLen:', await ev(c, 'document.getElementById("view").innerHTML.length'));

  c.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
