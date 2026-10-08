/* 把 ttyd 页面（单文件内联 bundle）抓下来，反查它真正的 WebSocket 协议。
   目的：搞清「为什么连上了却收不到任何字节」——
   是握手少了 Sec-WebSocket-Protocol，还是首发 JSON 必须用二进制帧。 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'probe', 'ttyd.html');

function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: (process.env.OWR_HOST || '192.168.1.1'), port: 7681, path: p }, r => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', c => b += c);
      r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers }));
    }).on('error', rej);
  });
}

(async () => {
  const idx = await get('/');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, idx.body);
  console.log('GET / ->', idx.status, idx.body.length, 'bytes ->', OUT);

  const tok = await get('/token');
  console.log('GET /token ->', tok.status, JSON.stringify(tok.body.slice(0, 120)));

  const s = idx.body;

  // 1) 首发报文的构造方式
  let i = s.indexOf('AuthToken');
  while (i !== -1) {
    console.log('\n--- AuthToken @' + i + ' ---');
    console.log(s.slice(Math.max(0, i - 260), i + 160).replace(/\s+/g, ' '));
    i = s.indexOf('AuthToken', i + 1);
    if (i > 600000) break;
  }

  // 2) 输入数据的发送（看有没有 '0'/'1' 之类的操作码前缀）
  for (const k of ['sendData', 'TextEncoder', 'binaryType', 'protocols', 'new WebSocket(']) {
    let j = s.indexOf(k);
    if (j === -1) { console.log('\n[' + k + '] not found'); continue; }
    console.log('\n=== ' + k + ' @' + j + ' ===');
    console.log(s.slice(Math.max(0, j - 200), j + 260).replace(/\s+/g, ' '));
  }

  // 3) 是否默认走 WebGL 渲染器（决定 Android WebView 里会不会画不出来）
  const webglHits = (s.match(/webgl/gi) || []).length;
  console.log('\nwebgl mentions:', webglHits);
  const w = s.indexOf('webgl');
  if (w !== -1) console.log('webgl ctx:', s.slice(Math.max(0, w - 200), w + 220).replace(/\s+/g, ' '));
})();
