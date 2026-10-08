/* 果化改动的验收：小标题跟随滚动 + 底栏实心图标 + 底部卡片表单 + 下拉刷新。
   顺带把每一步截图存下来。 */
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
  const ev = async e => {
    const r = await c.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async name => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    if (r.result && r.result.data) { fs.writeFileSync('build/shots/' + name, Buffer.from(r.result.data, 'base64')); }
  };
  const probe = () => ev(`JSON.stringify({
    scrollY: Math.round(window.scrollY),
    bigBottom: (function(){var b=document.querySelector('#view .page-title');return b?Math.round(b.getBoundingClientRect().bottom):null})(),
    navBottom: Math.round(document.getElementById('nav').getBoundingClientRect().bottom),
    dim: document.getElementById('nav-title').classList.contains('dim'),
    navTitle: document.getElementById('nav-title').textContent,
    navOpacity: getComputedStyle(document.getElementById('nav-title')).opacity
  })`);

  console.log('--- 1. 概览页回到顶部 ---');
  await ev('App.setTab("overview"); window.scrollTo(0,0); "ok"');
  await sleep(900);
  console.log('  ', await probe());
  await shot('v113-a-top.png');

  console.log('--- 2. 向下滚动 160px（大标题应滚走、小标题淡入）---');
  await ev('window.scrollTo(0,160); "ok"');
  await sleep(700);
  console.log('  ', await probe());
  await shot('v113-b-scrolled.png');

  console.log('--- 3. 底栏实心图标 ---');
  console.log('  ', await ev(`(function(){
    var on = document.querySelector('.tab-item.active');
    var fill = on.querySelector('.ic-fill'), line = on.querySelector('.ic-line');
    return JSON.stringify({ tab: on.dataset.tab,
      fillDisplay: getComputedStyle(fill).display, lineDisplay: getComputedStyle(line).display });
  })()`));

  console.log('--- 4. 表单弹窗应走底部卡片 ---');
  await ev('App.setTab("menu"); "ok"'); await sleep(700);
  await ev('App.editSystemNtp ? App.editSystemNtp() : App.editSystemBasic(); "ok"');
  await sleep(700);
  console.log('  ', await ev(`(function(){
    var m = document.querySelector('#modal-root .modal-mask');
    var box = m && m.querySelector('.modal');
    if (!m) return '没有弹窗';
    var r = box.getBoundingClientRect();
    return JSON.stringify({ sheet: m.classList.contains('sheet'),
      bottomGap: Math.round(window.innerHeight - r.bottom),
      radius: getComputedStyle(box).borderTopLeftRadius });
  })()`));
  await shot('v113-c-sheet.png');
  await ev(`document.querySelector('#modal-root [data-action="modal-cancel"]').click(); "closed"`);

  console.log('--- 5. 下拉刷新（模拟手势）---');
  await ev('App.setTab("overview"); window.scrollTo(0,0); "ok"'); await sleep(800);
  const r = await ev(`(async function(){
    var view = document.getElementById('view');
    function t(type, y){ var e = new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: view, clientX: 200, clientY: y })] });
      view.dispatchEvent(e); }
    t('touchstart', 300);
    for (var y = 320; y <= 460; y += 20) t('touchmove', y);
    var pulled = view.style.transform;
    t('touchend', 460);
    await new Promise(r2 => setTimeout(r2, 2600));
    return JSON.stringify({ pulledTransformAtPeak: pulled, afterRelease: view.style.transform,
      refreshing: App.refreshing, ptrOpacity: getComputedStyle(document.getElementById('ptr')).opacity });
  })()`);
  console.log('  ', r);
  await shot('v113-d-ptr.png');

  console.log('--- 6. 运行时报错 ---');
  console.log('  errors =', await ev('JSON.stringify(window.__owrErr || [])'));
  c.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
