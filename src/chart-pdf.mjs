import {journalPdf} from './journal-pdf.mjs';
import {orderedEvents} from './journal-model.mjs';
export async function chartPdf(data,lib){
 const {PDFDocument,PDFName,PDFHexString,PDFOperator,StandardFonts,rgb}=lib;
 if(!data||!Number.isFinite(data.width)||!Number.isFinite(data.height)||data.width<=0||data.height<=0||data.width*data.height>40000000)throw new Error('Kartvyn är för stor eller saknas.');
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle(data.title||'Mätkarta');
 const page=doc.addPage([841.89,595.28]),margin=32,scale=Math.min(777/data.width,450/data.height),w=data.width*scale,h=data.height*scale,x=(841.89-w)/2,y=78+(450-h)/2;
 const groups=[],properties=doc.context.obj({});
 page.node.Resources().set(PDFName.of('Properties'),properties);
 async function layer(name,key,draw){const ref=doc.context.register(doc.context.obj({Type:'OCG',Name:PDFHexString.fromText(name)}));groups.push(ref);properties.set(PDFName.of(key),ref);page.pushOperators(PDFOperator.of('BDC',[PDFName.of('OC'),PDFName.of(key)]));await draw();page.pushOperators(PDFOperator.of('EMC'));}
 const pos=p=>({x:x+p.x*scale,y:y+h-p.y*scale});
 if(data.layers.background)await layer('Kartbakgrund','Base',async()=>{const img=await doc.embedPng(data.png);page.drawImage(img,{x,y,width:w,height:h});});
 const points=data.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=data.width&&p.y<=data.height);
 if(data.layers.points)await layer('Mätpunkter','Points',()=>{for(const p of points)page.drawCircle({...pos(p),size:1.8,color:rgb(.05,.3,.5)});});
 let omitted=0;const occupied=[];
 if(data.layers.depths)await layer('Djupsiffror','Depths',()=>{for(const p of points){if(!Number.isFinite(p.depth))continue;const label=p.depth.toFixed(1),a=pos(p),lw=font.widthOfTextAtSize(label,8),r={x:a.x+3,y:a.y-3,w:lw+2,h:10};if(r.x+r.w>x+w||r.y<y||r.y+r.h>y+h||occupied.some(b=>r.x<b.x+b.w&&r.x+r.w>b.x&&r.y<b.y+b.h&&r.y+r.h>b.y)){omitted++;continue;}occupied.push(r);page.drawRectangle({x:r.x-1,y:r.y-1,width:r.w,height:r.h,color:rgb(1,1,1)});page.drawText(label,{x:r.x,y:r.y,size:8,font,color:rgb(.05,.2,.35)});}});
 const rows=orderedEvents(data.rows),positions=new Map(data.observations.map(p=>[p.id,p]));
 if(data.layers.observations)await layer('Observationer','Observations',()=>{
  const labels=[];
  for(const [i,row] of rows.entries()){
   const p=positions.get(row.event.id);if(!p)continue;const origin=pos(p);let a=null;
   for(let ring=0;ring<40&&!a;ring++)for(let step=0;step<(ring?16:1);step++){
    const candidate={x:origin.x+ring*17*Math.cos(step*Math.PI/8),y:origin.y+ring*17*Math.sin(step*Math.PI/8)};
    if(candidate.x<x+8||candidate.x>x+w-8||candidate.y<y+8||candidate.y>y+h-8||labels.some(b=>Math.hypot(b.x-candidate.x,b.y-candidate.y)<17))continue;
    a=candidate;break;
   }
   if(!a)throw new Error('För många observationer i kartvyn. Zooma in innan export.');labels.push(a);
   if(Math.hypot(a.x-origin.x,a.y-origin.y)>1){page.drawLine({start:origin,end:a,thickness:.5,color:rgb(.48,.19,.58)});page.drawCircle({...origin,size:1.5,color:rgb(.48,.19,.58)});}
   page.drawCircle({...a,size:7,color:rgb(.48,.19,.58),borderColor:rgb(1,1,1),borderWidth:1});const label=String(i+1);page.drawText(label,{x:a.x-bold.widthOfTextAtSize(label,8)/2,y:a.y-3,size:8,font:bold,color:rgb(1,1,1)});
  }
 });
 doc.catalog.set(PDFName.of('OCProperties'),doc.context.obj({OCGs:groups,D:{Order:groups,ON:groups,OFF:[]}}));
 doc.catalog.set(PDFName.of('PageMode'),PDFName.of('UseOC'));
 const title=(data.title||'Mätkarta').slice(0,100);page.drawText(title,{x:margin,y:558,size:Math.min(16,777/bold.widthOfTextAtSize(title,1)),font:bold});
 page.drawText('Djup i meter. Blå punkter: mätspår. Lila nummer: observationsförteckning.',{x:margin,y:55,size:10,font});
 page.drawText(`${points.length} mätpunkter. ${rows.length} observationer. ${omitted} överlappande djupsiffror utelämnade.`,{x:margin,y:40,size:9,font});
 const attribution='Kartunderlag: '+(data.attribution||'Lokalt fältmanus')+'. Ej avsedd som navigationssjökort.';page.drawText(attribution,{x:margin,y:25,size:Math.min(8,777/font.widthOfTextAtSize(attribution,1)),font});
 let info=doc.addPage([595.28,841.89]),cy=790;
 function line(text){for(const paragraph of String(text).replaceAll('−','-').split('\n')){let part='';for(const word of paragraph.split(' ')){if(font.widthOfTextAtSize(part+' '+word,10)>495){if(part)write(part);part='';for(const char of word){if(font.widthOfTextAtSize(part+char,10)>495){write(part);part='';}part+=char;}}else part+=(part?' ':'')+word;}write(part);}}
 function write(text){if(cy<50){info=doc.addPage([595.28,841.89]);cy=790;}info.drawText(text,{x:48,y:cy,size:10,font});cy-=16;}
 line('MÄTUNDERLAG');line('Exporterad '+new Date().toISOString());line('Kartan återger aktuell kartvy. Kartbakgrunden är raster; tillagda punkter och siffror är vektorer.');
 line('Djupsiffror för spår använder spårets vattenståndskorrigering och extra djupjustering. Ingen ytterligare vattenståndskorrigering görs vid export.');
 for(const text of data.tracks)line(text);
 line('Observationernas rådjup, mätmetod och eventuella vattenståndskorrigering redovisas i förteckningen. Endast sparade observationer inom kartbilden ingår.');
 if(data.layers.observations&&rows.length){const report=await PDFDocument.load(await journalPdf(rows,lib));for(const p of await doc.copyPages(report,report.getPageIndices()))doc.addPage(p);}
 return doc.save();
}
