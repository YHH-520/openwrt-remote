/* ttyd 真实协议验证（修正版）。
   上一版错在：把子协议写成 options.protocol，ws 不认，实际没发出去，
   所以 Proto 始终是空的 —— 服务端也就没给它绑 tty 协议处理器。
   正确写法是把它作为构造函数第二个参数：new WebSocket(url, ['tty'], opts)。

   协议（反查 bundle 得到）：
     new WebSocket(url, ["tty"])
     首发：二进制帧，内容 = JSON.stringify({AuthToken, columns, rows})
     输入：'0' 字节 + 原始字节
     缩放：'1' 字节 + JSON.stringify({columns, rows})
*/
const { WebSocket } = require((process.env.OWR_WS || 'ws'));

function attempt(name, protocols) {
  return new Promise(resolve => {
    const ws = new WebSocket('ws://192.168.1.1:7681/ws', protocols, { perMessageDeflate: false });
    let got = 0, done = false;
    const fin = () => { if (done) return; done = true; try { ws.close(); } catch (e) {} resolve(got); };
    const kill = setTimeout(() => { console.log(`[${name}] TIMEOUT got=${got}`); fin(); }, 6000);

    ws.on('upgrade', res => {
      console.log(`[${name}] 101 proto="${res.headers['sec-websocket-protocol'] || '-'}" ` +
                  `accept-ext="${res.headers['sec-websocket-extensions'] || '-'}"`);
    });
    ws.on('open', () => {
      console.log(`[${name}] open, socket.protocol="${ws.protocol}"`);
      ws.send(new TextEncoder().encode(JSON.stringify({ AuthToken: '', columns: 80, rows: 24 })));
      setTimeout(() => {
        const b = Buffer.concat([Buffer.from([0x30]), Buffer.from('uname -a\r', 'utf8')]);
        try { ws.send(b); } catch (e) {}
      }, 500);
    });
    ws.on('message', d => {
      got++;
      const s = Buffer.isBuffer(d) ? d.toString('utf8') : String(d);
      console.log(`[${name}] msg#${got} len=${s.length}: ${JSON.stringify(s.slice(0, 220))}`);
      if (got >= 4) { clearTimeout(kill); fin(); }
    });
    ws.on('close', (c, r) => { console.log(`[${name}] CLOSE code=${c} reason=${r}`); clearTimeout(kill); fin(); });
    ws.on('error', e => { console.log(`[${name}] ERR ${e.message}`); clearTimeout(kill); fin(); });
  });
}

(async () => {
  console.log('=== A: protocols=["tty"]（应该是正确的） ===');
  await attempt('A', ['tty']);
  console.log('\n=== B: 不给子协议（对照） ===');
  await attempt('B', undefined);
  process.exit(0);
})();
