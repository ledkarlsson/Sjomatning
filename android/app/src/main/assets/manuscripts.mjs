import {parseGeoPdf,affineFit} from './geo-reference.mjs';
import {readRasterChart,rasterPixels} from './raster-chart.mjs';
import {geoToMapPixel} from './web-map.mjs';

async function read(path){const response=await fetch('/api/'+path);if(!response.ok)throw new Error('Kunde inte läsa fältmanusen. Kontrollera nyckeln och anslutningen.');return response;}
export async function loadManuscripts(progress){
  const files=(await (await read('files')).json()).filter(f=>/\.(pdf|kap|wci)$/i.test(f.name));
  const layers=[];let skipped=0,pixels=0;
  for(const file of files){
    progress('Hämtar '+file.name+'…');let task;
    try{
      const bytes=new Uint8Array(await (await read('files/'+file.id+'/content')).arrayBuffer());let geometry,canvas,crop;
      if(/\.(kap|wci)$/i.test(file.name)){
        const chart=readRasterChart(bytes,file.name);geometry=chart.geometry;const image=await rasterPixels(chart,1024);
        canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(new ImageData(image.rgba,image.width,image.height),0,0);crop={x:0,y:0,width:canvas.width,height:canvas.height};
      }else{
        const points=parseGeoPdf(bytes);if(!points){skipped++;continue;}
        const t=affineFit(points.map(p=>({x:p.nx,y:1-p.ny,lat:p.lat,lon:p.lon})));if(!t)throw new Error('Geodata saknas');
        geometry=(x,y)=>({lon:t.lon[0]*x+t.lon[1]*y+t.lon[2],lat:t.lat[0]*x+t.lat[1]*y+t.lat[2]});
        const pdfjs=await import('./pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdf.worker.mjs',import.meta.url).href;
        const raw=new TextDecoder('latin1').decode(bytes);task=pdfjs.getDocument({data:bytes,useSystemFonts:true});const pdf=await task.promise;progress('Ritar '+file.name+'…');const page=await pdf.getPage(1),original=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,1024/Math.max(original.width,original.height))});
        canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;progress('Placerar '+file.name+'…');
        const match=raw.match(/\/VP\s*\[\s*<<\s*\/BBox\s*\[([^\]]+)\]/),box=match?match[1].trim().split(/\s+/).map(Number):page.view,a=viewport.convertToViewportPoint(box[0],box[1]),b=viewport.convertToViewportPoint(box[2],box[3]);crop={x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])};
      }
      const corners=[[0,0],[1,0],[1,1],[0,1]].map(p=>geometry(...p));
      if(!corners.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180)||!crop.width||!crop.height)throw new Error('Ogiltiga geodata');
      pixels+=canvas.width*canvas.height;if(pixels>24000000){skipped++;continue;}
      layers.push({canvas,crop,geometry,name:file.name});
    }catch(error){skipped++;}finally{if(task)await task.destroy();}
  }
  return {message:!layers.length?(files.length?'Inga fältmanus kunde visas. Kontrollera geodata och anslutning.':'Inga fältmanus tillgängliga för din nyckel.'):(skipped?`${layers.length} fältmanus visas · ${skipped} kunde inte läsas eller saknar geodata.`:''),draw(ctx,map){
    for(const layer of layers){
      const project=(x,y)=>{const p=layer.geometry(x,y);return geoToMapPixel(map,p.lat,p.lon);},corners=[[0,0],[1,0],[1,1],[0,1]].map(p=>project(...p));
      if(Math.max(...corners.map(p=>p.x))<0||Math.min(...corners.map(p=>p.x))>map.width||Math.max(...corners.map(p=>p.y))<0||Math.min(...corners.map(p=>p.y))>map.height)continue;
      const steps=12;for(let row=0;row<steps;row++)for(let col=0;col<steps;col++){
        const x=col/steps,y=row/steps,d=1/steps;for(const vertices of [[[x,y],[x+d,y],[x+d,y+d]],[[x,y],[x+d,y+d],[x,y+d]]]){
          const target=vertices.map(p=>project(...p)),fit=affineFit(vertices.map((p,i)=>({x:layer.crop.x+p[0]*layer.crop.width,y:layer.crop.y+p[1]*layer.crop.height,lon:target[i].x,lat:target[i].y})));if(!fit)continue;
          ctx.save();ctx.beginPath();target.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.clip();ctx.transform(fit.lon[0],fit.lat[0],fit.lon[1],fit.lat[1],fit.lon[2],fit.lat[2]);ctx.drawImage(layer.canvas,0,0);ctx.restore();
        }
      }
      ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle='#9b2868';ctx.lineWidth=1;ctx.stroke();
    }
  }};
}
