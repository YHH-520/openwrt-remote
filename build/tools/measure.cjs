// measure painted (non-black) bounding box of a PNG screenshot
const fs = require('fs'), zlib = require('zlib');
function load(p){
  const d=fs.readFileSync(p); let i=8, idat=[], w,h,ct;
  while(i<d.length){const ln=d.readUInt32BE(i), typ=d.toString('ascii',i+4,i+8), da=d.subarray(i+8,i+8+ln); i+=12+ln;
    if(typ==='IHDR'){w=da.readUInt32BE(0);h=da.readUInt32BE(4);ct=da[9];}
    else if(typ==='IDAT') idat.push(da); else if(typ==='IEND') break;}
  const raw=zlib.inflateSync(Buffer.concat(idat)); const ch={0:1,2:3,3:1,4:2,6:4}[ct], stride=w*ch;
  const out=Buffer.alloc(w*h*ch); let prev=Buffer.alloc(stride), pos=0;
  for(let y=0;y<h;y++){const f=raw[pos++]; const line=Buffer.from(raw.subarray(pos,pos+stride)); pos+=stride;
    if(f===1) for(let x=ch;x<stride;x++) line[x]=(line[x]+line[x-ch])&255;
    else if(f===2) for(let x=0;x<stride;x++) line[x]=(line[x]+prev[x])&255;
    else if(f===3) for(let x=0;x<stride;x++){const a=x>=ch?line[x-ch]:0; line[x]=(line[x]+((a+prev[x])>>1))&255;}
    else if(f===4) for(let x=0;x<stride;x++){const a=x>=ch?line[x-ch]:0,b=prev[x],c=x>=ch?prev[x-ch]:0; const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c); line[x]=(line[x]+((pa<=pb&&pa<=pc)?a:(pb<=pc?b:c)))&255;}
    line.copy(out,y*stride); prev=line;}
  return {w,h,ch,px:out};
}
const {w,h,ch,px}=load(process.argv[2]);
// interest region: the app window (exclude status bar / nav bar / system)
const y0=Number(process.argv[3]||170), y1=Number(process.argv[4]||2179);
let minX=1e9,maxX=-1,minY=1e9,maxY=-1;
const rowLast=[];
for(let y=y0;y<y1;y++){
  let last=-1;
  for(let x=0;x<w;x++){
    const o=(y*w+x)*ch;
    if(px[o]||px[o+1]||px[o+2]){ last=x; if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
  }
  rowLast.push([y,last]);
}
console.log(JSON.stringify({size:[w,h],region:[y0,y1],paintedBBox:[minX,minY,maxX,maxY]}));
// print first row where painting stops (last<0) and how far it goes
const rowsWithPaint = rowLast.filter(r=>r[1]>=0);
if(rowsWithPaint.length){
  console.log('first painted row:', rowsWithPaint[0][0], 'last painted row:', rowsWithPaint[rowsWithPaint.length-1][0]);
  const sample=[];
  for(let y=y0;y<Math.min(y0+1200,y1);y+=100){ const r=rowLast.find(a=>a[0]===y); sample.push([y, r?r[1]:null]); }
  console.log('rightmost non-black x by row:', JSON.stringify(sample));
}
