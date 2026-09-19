import {viewportMap,panMap,zoomMap,visibleTiles,geoToMapPixel,mapPixelToGeo} from './web-map.mjs';
const canvas=document.querySelector('#map'),ctx=canvas.getContext('2d'),status=document.querySelector('#status');
let map,fix=null,follow=true,queued=false,manuscripts=null,showManuscripts=false,libraryMessage='';
const cache=new Map(),pointers=new Map();
function schedule(){if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;draw();});}}
function tile(url){let entry=cache.get(url);if(entry){cache.delete(url);cache.set(url,entry);return entry;}
  const image=new Image();entry={image,ready:false,error:false};cache.set(url,entry);
  image.onload=()=>{entry.ready=true;schedule();};image.onerror=()=>{entry.error=true;schedule();};image.src=url;
  if(cache.size>256)cache.delete(cache.keys().next().value);return entry;
}
function resize(){const w=canvas.clientWidth,h=canvas.clientHeight,ratio=devicePixelRatio||1;const center=map?mapPixelToGeo(map,map.width/2,map.height/2):{lat:58.53,lon:15.7};canvas.width=w*ratio;canvas.height=h*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);map=viewportMap(center,map?.zoom||12,w,h);schedule();}
function draw(){if(!map)return;ctx.clearRect(0,0,map.width,map.height);let loaded=0,errors=0;
  const tiles=visibleTiles(map);
  for(const t of tiles){const base=tile(`https://tile.openstreetmap.org/${t.zoom}/${t.x}/${t.y}.png`);if(base.ready){ctx.drawImage(base.image,t.dx,t.dy,t.size+0.5,t.size+0.5);loaded++;}if(base.error)errors++;}
  for(const t of tiles){const marks=tile(`https://tiles.openseamap.org/seamark/${t.zoom}/${t.x}/${t.y}.png`);if(marks.ready)ctx.drawImage(marks.image,t.dx,t.dy,t.size+0.5,t.size+0.5);}
  if(manuscripts)manuscripts.draw(ctx,map,showManuscripts);
  if(fix){const p=geoToMapPixel(map,fix.lat,fix.lon),mpp=156543.03392*Math.cos(fix.lat*Math.PI/180)/2**map.zoom;ctx.beginPath();ctx.arc(p.x,p.y,Math.min(2000,Math.max(3,fix.accuracy/mpp)),0,Math.PI*2);ctx.fillStyle=fix.fresh?'#1676dc25':'#6c778325';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fillStyle=fix.fresh?'#1676dc':'#6c7783';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='white';ctx.stroke();}
  status.textContent=libraryMessage || (errors&&!loaded?'Kartan kunde inte hämtas. Kontrollera internet.':!loaded?'Laddar karta…':!fix?'Väntar på position':fix.fresh?'':'Senaste kända position');status.hidden=!status.textContent;
  document.querySelector('#follow').style.background=follow?'#e1f2ff':'white';
}
window.updatePosition=data=>{fix=data.fix;if(fix&&follow&&map)map=viewportMap(fix,map.zoom,map.width,map.height);schedule();};
document.querySelector('#follow').onclick=()=>{follow=true;if(fix)map=viewportMap(fix,map.zoom,map.width,map.height);schedule();};
canvas.onpointerdown=e=>{pointers.set(e.pointerId,{x:e.offsetX,y:e.offsetY});canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId),others=[...pointers.entries()].filter(([id])=>id!==e.pointerId);follow=false;
  if(others.length){const other=others[0][1],before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.offsetX-other.x,e.offsetY-other.y);if(before>0&&after>0)map=zoomMap(map,map.zoom+Math.log2(after/before),(e.offsetX+other.x)/2,(e.offsetY+other.y)/2);}else map=panMap(map,e.offsetX-old.x,e.offsetY-old.y);
  pointers.set(e.pointerId,{x:e.offsetX,y:e.offsetY});schedule();};
canvas.onpointerup=canvas.onpointercancel=e=>pointers.delete(e.pointerId);
new ResizeObserver(resize).observe(canvas);resize();
const manuscriptButton=document.querySelector('#manuscripts');
function label(){manuscriptButton.textContent=showManuscripts?'Dölj fältmanus':'Visa fältmanus';manuscriptButton.setAttribute('aria-pressed',String(showManuscripts));schedule();}
manuscriptButton.onclick=()=>{libraryMessage='';if(manuscripts){showManuscripts=!showManuscripts;label();return;}manuscriptButton.disabled=true;libraryMessage='Hämtar fältmanus…';schedule();window.ChartAccess.openLibrary();};
window.libraryError=message=>{libraryMessage=message;manuscriptButton.disabled=false;label();};
window.libraryReady=async()=>{try{const {loadManuscripts}=await import('./manuscripts.mjs');manuscripts=await loadManuscripts(message=>{libraryMessage=message;schedule();});showManuscripts=true;libraryMessage=manuscripts.message;manuscriptButton.disabled=false;label();}catch(error){window.libraryError(error.message);}};
