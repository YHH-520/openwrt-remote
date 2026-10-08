const http = require('http');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
http.get({ host: (process.env.OWR_HOST || '192.168.1.1'), port: 7681, path: '/' }, r => {
  let b = '';
  r.on('data', c => b += c);
  r.on('end', () => {
    console.log('status', r.statusCode, 'len', b.length);
    const m = b.match(/xterm[^"'\/]*\.js|webgl|renderer|addon[^"'\/]*/gi);
    console.log('assets:', [...new Set(m || [])].slice(0, 12).join(', '));
    const tok = b.match(/token["'\s:=]+([^"',;]+)/i);
    console.log('token field:', tok ? tok[1] : '-');
    const ws = new WebSocket('ws://192.168.1.1:7681/ws', { perMessageDeflate: false });
    ws.on('open', () => { console.log('ws open'); ws.send(JSON.stringify({ AuthToken: '', columns: 80, rows: 24 })); });
    ws.on('message', d => {
      const s = d.toString();
      console.log('ws msg[' + s.length + ']:', JSON.stringify(s.slice(0, 180)));
      clearTimeout(kill); ws.close(); process.exit(0);
    });
    ws.on('error', e => { console.log('ws err', e.message); process.exit(1); });
    const kill = setTimeout(() => { console.log('ws timeout'); process.exit(2); }, 7000);
  });
}).on('error', e => console.log('http err', e.message));
