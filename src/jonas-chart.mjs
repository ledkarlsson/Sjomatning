const finite=v=>typeof v==='number'&&Number.isFinite(v);
function solve(a,b){a=a.map((r,i)=>[...r,b[i]]);for(let c=0;c<3;c++){let pivot=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;[a[c],a[pivot]]=[a[pivot],a[c]];if(Math.abs(a[c][c])<1e-14)throw new Error('Jonas kalibreringspunkter ligger på samma linje.');const d=a[c][c];a[c]=a[c].map(v=>v/d);for(let r=0;r<3;r++)if(r!==c){const f=a[r][c];a[r]=a[r].map((v,i)=>v-f*a[c][i]);}}return a.map(r=>r[3]);}
export async function readJonasMetadata(doc){
 const attachments=await doc.getAttachments();const names=attachments instanceof Map?[...attachments.keys()]:Object.keys(attachments||{});
 if(!names.includes('chart_metadata.json'))return null;
 const bytes=doc.getAttachmentContent?await doc.getAttachmentContent('chart_metadata.json'):attachments['chart_metadata.json'].content;
 if(bytes.length>2000000)throw new Error('Jonas kartmetadata är för stora.');
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(data.format!=='roxenkortet.chart'||data.schema_version!==1||data.page_index_base!==0||!Array.isArray(data.pages))throw new Error('Jonas kartmetadata har ett format som inte stöds.');
 const g=data.coordinate_systems?.gps,p=data.coordinate_systems?.pdf;
 if(g?.datum!=='WGS84'||g.unit!=='decimal_degrees'||p?.space!=='pymupdf_unrotated'||p.unit!=='point'||p.points_per_inch!==72||p.origin!=='top_left'||p.x_direction!=='right'||p.y_direction!=='down')throw new Error('Jonas kartmetadata har ett okänt koordinatsystem.');
 const seen=new Set();for(const page of data.pages){if(!Number.isInteger(page.page_index)||page.page_index<0||page.page_index>=doc.numPages||seen.has(page.page_index))throw new Error('Ogiltigt sidindex i Jonas kartmetadata.');seen.add(page.page_index);const points=page.calibration_points;
  if(!Array.isArray(points)||points.length!==4||points.map(p=>p.id).sort().join('')!=='ABCD'||points.some(p=>!['x','y','lat','lon'].every(k=>finite(p[k]))||Math.abs(p.lat)>90||Math.abs(p.lon)>180))throw new Error('Ogiltiga kalibreringspunkter i Jonas kartmetadata.');
  if(!Array.isArray(page.keep_out_rectangles)||page.keep_out_rectangles.some(r=>!Array.isArray(r)||r.length!==4||!r.every(finite)||r[0]>=r[2]||r[1]>=r[3]))throw new Error('Ogiltiga undantagsytor i Jonas kartmetadata.');
 }
 return data;
}
export function jonasCalibration(metadata,page){
 const entry=metadata?.pages.find(p=>p.page_index===page.pageNumber-1);if(!entry)return null;
 const viewport=page.getViewport({scale:1}),u=page.userUnit||1,points=entry.calibration_points;
 const center={lat:points.reduce((s,p)=>s+p.lat,0)/4,lon:points.reduce((s,p)=>s+p.lon,0)/4};
 const design=points.map(p=>[p.lon-center.lon,p.lat-center.lat,1]);
 const positions=points.map(p=>viewport.convertToViewportPoint(page.view[0]+p.x/u,page.view[3]-p.y/u));
 const normal=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>design.reduce((s,r)=>s+r[i]*r[j],0)));
 const fit=k=>solve(normal,Array.from({length:3},(_,i)=>design.reduce((s,r,n)=>s+r[i]*positions[n][k],0)));
 const x=fit(0),y=fit(1),det=x[0]*y[1]-x[1]*y[0];if(!finite(det)||Math.abs(det)<1e-12)throw new Error('Jonas kalibrering kan inte inverteras.');
 const geometry=(nx,ny)=>{const dx=nx*viewport.width-x[2],dy=ny*viewport.height-y[2];return {lon:center.lon+(dx*y[1]-x[1]*dy)/det,lat:center.lat+(x[0]*dy-dx*y[0])/det};};
 const project=(lat,lon)=>({x:(x[0]*(lon-center.lon)+x[1]*(lat-center.lat)+x[2])/viewport.width,y:(y[0]*(lon-center.lon)+y[1]*(lat-center.lat)+y[2])/viewport.height});
 return {geometry,project,entry,points:points.map((p,i)=>({lat:p.lat,lon:p.lon,nx:positions[i][0]/viewport.width,ny:1-positions[i][1]/viewport.height})),residual:Math.max(...design.map((r,i)=>Math.hypot(r.reduce((s,v,k)=>s+v*x[k],0)-positions[i][0],r.reduce((s,v,k)=>s+v*y[k],0)-positions[i][1])))};
}
const mul=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export async function jonasDepthBoxes(page,entry,OPS){
 const ops=await page.getOperatorList(),view=page.getViewport({scale:1}),stack=[],boxes=[];let matrix=[1,0,0,1,0,0],red=false;
 const point=(x,y)=>view.convertToViewportPoint(matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]);
 for(let i=0;i<ops.fnArray.length;i++){const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===OPS.save){stack.push({matrix:[...matrix],red});continue;}if(fn===OPS.restore){const saved=stack.pop();if(saved)({matrix,red}=saved);continue;}
  if(fn===OPS.transform){matrix=mul(matrix,args);continue;}
  if(fn===OPS.setStrokeRGBColor){const hex=args[0];red=typeof hex==='string'&&/^#[a-f0-9]{6}$/i.test(hex)&&parseInt(hex.slice(1,3),16)>204&&parseInt(hex.slice(3,5),16)<77&&parseInt(hex.slice(5,7),16)<77;continue;}
  if(fn!==OPS.constructPath||!red||args[0]!==OPS.stroke||args[1]?.length!==1)continue;
  const path=Array.from(args[1][0]);if(path.length!==18||path[0]!==0||[3,6,9,12,15].some(k=>path[k]!==1))continue;
  const coords=[0,3,6,9,12,15].map(k=>point(path[k+1],path[k+2]));
  if(Math.hypot(coords[0][0]-coords[4][0],coords[0][1]-coords[4][1])>.1||Math.hypot(coords[1][0]-coords[5][0],coords[1][1]-coords[5][1])>.1)continue;
  const xs=coords.map(p=>p[0]),ys=coords.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys),w=right-left,h=bottom-top;
  if(w<2||w>30||h<2||h>30||w/h<.4||w/h>2.5)continue;
  if((left+right)/2<-.001||(left+right)/2>view.width+.001||(top+bottom)/2<-.001||(top+bottom)/2>view.height+.001)continue;
  const raw=view.convertToPdfPoint((left+right)/2,(top+bottom)/2),u=page.userUnit||1,px=(raw[0]-page.view[0])*u,py=(page.view[3]-raw[1])*u;
  if(entry.keep_out_rectangles.some(r=>px>=r[0]&&px<=r[2]&&py>=r[1]&&py<=r[3]))continue;
  boxes.push({x:left/view.width,y:top/view.height,w:w/view.width,h:h/view.height,width:w,height:h});
 }
 const median=values=>{values.sort((a,b)=>a-b);return (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;};
 const mw=median(boxes.map(b=>b.width)),mh=median(boxes.map(b=>b.height));return boxes.filter(b=>b.width>=mw*.7&&b.width<=mw*1.3&&b.height>=mh*.7&&b.height<=mh*1.3);
}
export function fillDepthBoxes(boxes,points){return boxes.map(box=>{const inside=points.filter(p=>Number.isFinite(p.depth)&&p.x>=box.x&&p.x<=box.x+box.w&&p.y>=box.y&&p.y<=box.y+box.h),pole=inside.filter(p=>p.method==='pole');let depth=null,method=null;
 if(pole.length){depth=Math.min(...pole.map(p=>p.depth));method='pole';}else{const values=inside.filter(p=>p.method!=='pole').map(p=>p.depth).sort((a,b)=>a-b);if(values.length===3&&values[2]-values[0]<=.100001){depth=values.reduce((a,b)=>a+b,0)/3;method='mean';}else if(values.length>=4){const trimmed=values.slice(1,-1);depth=trimmed.reduce((a,b)=>a+b,0)/trimmed.length;method='mean';}}
 return {...box,depth,method,count:inside.length};});}
export function jonasTrackPoints(track){if(track.sourceFormat!=='trc')return track.points;let previous=null;return track.points.filter(p=>{if(p.depth<.2||p.depth>50)return false;if(previous&&p.lat===previous.lat&&p.lon===previous.lon&&p.depth===previous.depth)return false;previous=p;return true;});}
