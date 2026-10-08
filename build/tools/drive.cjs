const http = require('http'), fs = require('fs');
const { WebSocket } = require((process.env.OWR_WS || 'ws'));
const ROOT = (process.env.OWR_ROOT || process.cwd());
function getJSON(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:9222,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))}).on('error',rej)})}
function connect(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url,{perMessageDeflate:false});const pend=new Map();let id=0;
  ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
  ws.once('error',reject);
  ws.once('open',()=>resolve({send:(m,p={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}))}),close:()=>ws.close()}))})}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  const targets = await getJSON('/json');
  const page = targets.find(t=>(t.url||'').includes('index.html'));
  const c = await connect(page.webSocketDebuggerUrl);
  async function evaluate(expr){
    const r = await c.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.result&&r.result.exceptionDetails) return {__error:r.result.exceptionDetails.text,detail:(r.result.exceptionDetails.exception||{}).description};
    return r.result&&r.result.result?r.result.result.value:r;
  }
  async function shot(f){const r=await c.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(f,Buffer.from(r.result.data,'base64'));return fs.statSync(f).size}
  await evaluate("window.__errs=window.__errs||[];");
  const steps = JSON.parse(process.argv[2] || '[["renderNet","network"],["renderWireless","wireless"]]');
  for (const [fn, tag] of steps) {
    await evaluate("document.getElementById('nav-title').textContent='"+tag+"';App.state.detail='"+tag+"';");
    await evaluate('App.'+fn+'()');
    await sleep(900);
    const info = await evaluate("JSON.stringify({len:document.getElementById('view').innerHTML.length,txt:document.getElementById('view').innerText.replace(/\\n/g,' | ').slice(0,300)})");
    const bytes = await shot(ROOT+'/build/shots/v109-'+tag+'.png');
    console.log('== '+tag+' ('+bytes+'B) '+info);
  }
  const scroll = process.argv[3];
  if (scroll) { await evaluate("window.scrollTo(0,"+scroll+")"); await sleep(400); await shot(ROOT+'/build/shots/v109-scroll.png'); console.log('scroll shot done'); }
  console.log('ERRORS: '+await evaluate('JSON.stringify(window.__errs)'));
  process.exit(0);
})().catch(e=>{console.error('DRIVE ERR',e.message);process.exit(1)});
