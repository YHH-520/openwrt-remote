const http = require('http');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const getJSON = p => new Promise((res, rej) => http.get({host:'127.0.0.1',port:9222,path:p}, r => {let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej));
(async () => {
  const targets = await getJSON('/json');
  const page = targets.find(t => (t.url||'').includes('index.html')) || targets.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, {perMessageDeflate:false});
  const pend = new Map(); let id=0;
  ws.on('message', raw => { const m=JSON.parse(raw.toString()); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} });
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
  const [,, width, height, dsf] = process.argv;
  if (width === 'clear') { await send('Emulation.clearDeviceMetricsOverride'); console.log('cleared'); }
  else { await send('Emulation.setDeviceMetricsOverride', {width:+width, height:+height, deviceScaleFactor:+dsf, mobile:true}); console.log('override', width, height, dsf); }
  await new Promise(r=>setTimeout(r,1200));
  const ev = await send('Runtime.evaluate',{expression:'JSON.stringify({innerW:innerWidth,innerH:innerHeight,dpr:devicePixelRatio})',returnByValue:true});
  console.log('page:', ev.result.result.value);
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
