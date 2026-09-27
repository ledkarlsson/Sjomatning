export function parseGpx(text,name,Parser=globalThis.DOMParser){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('GPX med externa entiteter stöds inte.');
 const doc=new Parser().parseFromString(text,'application/xml'),root=doc.documentElement;
 if(root?.localName!=='gpx'||doc.getElementsByTagName('parsererror').length)throw new Error('Ogiltig GPX-fil.');
 const ns=root.namespaceURI;if(!['http://www.topografix.com/GPX/1/1','http://www.topografix.com/GPX/1/0'].includes(ns))throw new Error('GPX-versionen stöds inte.');
 const nodes=Array.from(doc.getElementsByTagNameNS(ns,'*')).filter(n=>['trkpt','rtept','wpt'].includes(n.localName)),points=[],warnings=[];
 const child=(node,key)=>Array.from(node.childNodes).find(n=>n.nodeType===1&&n.namespaceURI===ns&&n.localName===key)?.textContent;
 let previousParent=null,segment=0;
 for(const [index,node] of nodes.entries()){
  if(node.parentNode!==previousParent||node.localName==='wpt'){segment++;previousParent=node.parentNode;}
  const lat=Number(node.getAttribute('lat')),lon=Number(node.getAttribute('lon'));
  if(!node.hasAttribute('lat')||!node.hasAttribute('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){warnings.push(index+1);continue;}
  const rawTime=child(node,'time');let date='',time='';if(rawTime){if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(rawTime)||!Number.isFinite(Date.parse(rawTime))){warnings.push(index+1);}else{const iso=new Date(rawTime).toISOString();date=iso.slice(0,10);time=iso.slice(11,23);}}
  let depth=null;for(const ext of Array.from(node.getElementsByTagNameNS('*','*'))){if((ext.localName==='Depth'&&ext.namespaceURI==='http://www.garmin.com/xmlschemas/GpxExtensions/v3')||(ext.localName==='depth'&&['http://www.garmin.com/xmlschemas/TrackPointExtension/v1','http://www.garmin.com/xmlschemas/TrackPointExtension/v2'].includes(ext.namespaceURI))){const value=Number(ext.textContent);if(ext.textContent.trim()&&Number.isFinite(value))depth=value;else warnings.push(index+1);}}
  points.push({lat,lon,date,time,depth,speed:null,segment,coordinateText:{lat:node.getAttribute('lat'),lon:node.getAttribute('lon')},name:child(node,'name')||'',comment:child(node,'desc')||child(node,'cmt')||''});
 }
 if(!points.length)throw new Error('GPX-filen saknar giltiga positioner.');
 return {name,points,warnings,date:points.find(p=>p.date)?.date||'',waterLevel:null,correction:null};
}
