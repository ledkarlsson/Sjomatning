// Synthetic files for local browser verification; no real survey data.
import { PDFDocument, PDFName } from 'pdf-lib';
const origin='http://localhost:8787';
const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'local-browser-test-only'})});
if (!login.ok) throw new Error('Local test login failed');
const cookie=login.headers.get('set-cookie').split(';')[0];
const pdf=await PDFDocument.create(),page=pdf.addPage([400,400]); page.drawText('SYNTHETIC TEST CHART',{x:40,y:200,size:16});
page.node.set(PDFName.of('Measure'),pdf.context.obj({GPTS:[58.50,15.6,58.50,15.7,58.55,15.7,58.55,15.6],LPTS:[0,0,1,0,1,1,0,1]}));
const header='BSB/RA=4,2\r\nVER/1.1\r\nKNP/GD=WGS84,PR=MERCATOR\r\nREF/1,0,0,58.55,15.6\r\nREF/2,4,0,58.55,15.7\r\nREF/3,0,2,58.50,15.6\r\nREF/4,4,2,58.50,15.7\r\nRGB/1,140,190,210\r\n';
const kap=new Uint8Array([...Buffer.from(header),26,0,1,0,67,0,1,67,0]);
const meta='GD=WGS84\r\nPR=2\r\nDS=0,0\r\nC1=0,0,58.55,15.6\r\nC2=4,0,58.55,15.7\r\nC3=0,2,58.50,15.6\r\nC4=4,2,58.50,15.7\r\n';
const wci=new Uint8Array(33+meta.length),view=new DataView(wci.buffer);wci.set([87,67,73,1,6,1]);view.setUint16(12,4,true);view.setUint16(14,2,true);view.setUint32(16,33,true);view.setUint32(20,0xc0000000,true);view.setUint32(24,0x4000001c,true);wci.set([128,3,150,200,170],28);wci.set(Buffer.from(meta),33);
for(const [name,bytes] of [['Test-PDF.pdf',await pdf.save({useObjectStreams:false})],['Test-KAP.kap',kap],['Test-WCI.wci',wci]]) {
 const response=await fetch(origin+'/api/files?name='+name,{method:'POST',headers:{Origin:origin,Cookie:cookie},body:bytes});
 if(!response.ok) throw new Error(await response.text()); console.log('Uploaded synthetic fixture '+name);
}
