/* 从主机直连路由器，登录 LuCI 并把真实的侧边栏菜单树抓出来。
   目的：服务 / NAS / VPN / 统计 这些页面都是 LuCI 自带的 app，
   路径随固件和已装插件变化，硬编码一定会漏。
   先把真实菜单拿到手，App 里就能按实际菜单自动生成入口。

   登录：POST /cgi-bin/luci/  form: luci_username / luci_password -> 302 + Set-Cookie sysauth_http
*/
const http = require('http');
const HOST = process.env.OWR_HOST || '192.168.1.1';
const USER = process.env.OWR_USER || 'root';
const PASS = process.env.OWR_PASS || '';

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(Object.assign({ host: HOST, port: 80 }, opts), x => {
      let d = '';
      x.setEncoding('utf8');
      x.on('data', c => d += c);
      x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: d }));
    });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  // 1) 登录
  const form = 'luci_username=' + encodeURIComponent(USER) + '&luci_password=' + encodeURIComponent(PASS);
  const login = await req({
    method: 'POST', path: '/cgi-bin/luci/',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(form),
      'Referer': 'http://' + HOST + '/cgi-bin/luci/'
    }
  }, form);
  console.log('login ->', login.status, JSON.stringify(login.headers.location || ''));
  const sc = login.headers['set-cookie'] || [];
  const cookie = sc.map(c => c.split(';')[0]).join('; ');
  console.log('cookie:', cookie.slice(0, 80) || '(无)');
  if (!cookie) { console.log('登录失败，无法继续'); process.exit(1); }

  const get = async p => (await req({ method: 'GET', path: p, headers: { Cookie: cookie } })).body;

  // 2) 取 admin 页（Argon 主题的侧边栏在里面）
  let html = await get('/cgi-bin/luci/admin/');
  console.log('admin page len:', html.length);

  // 3) 提取菜单链接。不同主题结构不同，这里把几种常见容器都试一遍
  const items = [];
  const re = /<a\b[^>]*href="([^"]*\/cgi-bin\/luci\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    items.push({ href, text });
  }
  console.log('\n链接总数:', items.length);
  const seen = new Set();
  items.forEach(i => {
    if (seen.has(i.href)) return;
    seen.add(i.href);
    console.log('  ' + i.href.replace('/cgi-bin/luci', '') + '   <<' + i.text + '>>');
  });

  // 4) 顺带看看菜单容器长什么样，便于 App 里写选择器
  for (const sel of ['mainmenu', 'class="nav', 'id="topmenu', 'menu-main', 'sidebar']) {
    const i = html.indexOf(sel);
    console.log('\n[' + sel + '] @', i);
    if (i >= 0) console.log('   ', html.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, ' '));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
