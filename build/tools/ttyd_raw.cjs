/* 手写 WebSocket 握手，把服务端 101 响应的原始头打出来。
   目的：确认 libwebsockets 到底有没有接受 "tty" 子协议，
   以及需要哪个路径 / 版本头。
   同时对比几个候选路径（/ws、/ws/）。 */
const net = require('net');
const crypto = require('crypto');

function handshake(tag, p, extra) {
  return new Promise(resolve => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(7681, (process.env.OWR_HOST || '192.168.1.1'), () => {
      const lines = [
        'GET ' + p + ' HTTP/1.1',
        'Host: 192.168.1.1:7681',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        'Origin: http://192.168.1.1:7681'
      ].concat(extra || []).concat(['', '']);
      sock.write(lines.join('\r\n'));
    });
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { console.log('[' + tag + '] timeout, bytes=' + buf.length); sock.destroy(); resolve(); }, 3500);
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      // 一旦收到响应头结束就打印
      const s = buf.toString('latin1');
      if (s.indexOf('\r\n\r\n') !== -1) {
        clearTimeout(t);
        const head = s.split('\r\n\r\n')[0];
        console.log('\n===== ' + tag + '  GET ' + p + ' =====');
        console.log(head.split('\r\n').map(x => '  ' + x).join('\n'));
        const rest = buf.length - (head.length + 4);
        console.log('  [payload bytes after headers: ' + rest + ']');
        if (rest > 0) console.log('  raw:', buf.slice(head.length + 4, head.length + 44).toString('hex'));
        sock.destroy(); resolve();
      }
    });
    sock.on('error', e => { console.log('[' + tag + '] ERR ' + e.message); clearTimeout(t); resolve(); });
    sock.on('close', () => { clearTimeout(t); resolve(); });
  });
}

(async () => {
  await handshake('1-plain', '/ws');
  await handshake('2-subproto', '/ws', ['Sec-WebSocket-Protocol: tty']);
  await handshake('3-slash', '/ws/', ['Sec-WebSocket-Protocol: tty']);
  await handshake('4-all', '/ws', ['Sec-WebSocket-Protocol: tty, binary, base64']);
  process.exit(0);
})();
