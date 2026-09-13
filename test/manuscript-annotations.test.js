const test=require('node:test'),assert=require('node:assert/strict')
const {PDFDocument,degrees,PDFName}=require('pdf-lib')
const {validateAnnotations,displayPosition,exportAnnotatedManuscript}=require('../src/manuscript-annotations')
const note={id:'one',page:1,x:.25,y:.4,text:'4,2 m\nÅäö - kontroll',size:12,color:'#c62828'}
test('annotation validation rejects corrupt records and duplicate ids',()=>{
 assert.deepEqual(validateAnnotations([note]),[note])
 for(const changes of [{x:-.1},{page:0},{text:''},{size:100},{color:'red'}])assert.throws(()=>validateAnnotations([{...note,...changes}]))
 assert.throws(()=>validateAnnotations([note,note]))
})
test('export preserves all source pages, crop and rotation without changing original bytes',async()=>{
 const source=await PDFDocument.create()
 for(const angle of [0,90,180,270]){const p=source.addPage([400,500]);p.setCropBox(20,30,300,400);p.setRotation(degrees(angle));p.drawText('Original '+angle,{x:30,y:50})}
 const bytes=await source.save(),copy=bytes.slice()
 const annotations=[0,1,2,3].map((_,i)=>({...note,id:String(i),page:i+1}))
 const output=await exportAnnotatedManuscript({name:'manus.pdf',bytes,annotations})
 const result=await PDFDocument.load(output)
 assert.equal(result.getPageCount(),4);assert.deepEqual(bytes,copy)
 for(let i=0;i<4;i++){assert.equal(result.getPage(i).getRotation().angle,i*90);assert.deepEqual(result.getPage(i).getCropBox(),{x:20,y:30,width:300,height:400})}
 const expected=[{x:95,y:270,angle:0},{x:140,y:130,angle:90},{x:245,y:190,angle:180},{x:200,y:330,angle:270}]
 result.getPages().forEach((p,i)=>assert.deepEqual(displayPosition(p,.25,.4),expected[i]))
 await assert.rejects(()=>exportAnnotatedManuscript({name:'a.pdf',bytes,annotations:[{...note,page:5}]}),/sida/)
})
test('export converts a calibrated KAP image to a new PDF',async()=>{
 const header='BSB/RA=4,2\r\nVER/1.1\r\nKNP/GD=WGS84,PR=MERCATOR\r\nREF/1,0,0,59,15\r\nREF/2,4,0,59,16\r\nREF/3,0,2,58,15\r\nREF/4,4,2,58,16\r\nRGB/1,10,20,30\r\n'
 const bytes=new Uint8Array([...Buffer.from(header),26,0,1,0,67,0,1,67,0])
 const output=await exportAnnotatedManuscript({name:'a.kap',bytes,annotations:[]})
 assert.equal((await PDFDocument.load(output)).getPageCount(),1)
})

test('GeoPDF reference dictionaries remain readable on reimport',async()=>{
 const source=await PDFDocument.create(),page=source.addPage([400,500])
 page.node.set(PDFName.of('Measure'),source.context.obj({GPTS:[58,15,58,16,59,16,59,15],LPTS:[0,0,1,0,1,1,0,1]}))
 const bytes=await exportAnnotatedManuscript({name:'geodata.pdf',bytes:await source.save(),annotations:[note]})
 assert.match(Buffer.from(bytes).toString('latin1'),/\/GPTS\s*\[/)
 assert.match(Buffer.from(bytes).toString('latin1'),/\/LPTS\s*\[/)
})
