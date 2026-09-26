import {orderedEvents} from './journal-model.mjs';
export async function journalPdf(rows,{PDFDocument,StandardFonts,rgb}) {
  const doc=await PDFDocument.create();doc.setTitle('Observationsdagbok');
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  let page,y; const width=499,left=48,bottom=58;
  function newPage(){page=doc.addPage([595.28,841.89]);y=787;page.drawText('OBSERVATIONSDAGBOK',{x:left,y,size:19,font:bold,color:rgb(.08,.24,.29)});y-=27;page.drawText('Sjömätning | Händelsetider i UTC',{x:left,y,size:10,font:regular,color:rgb(.35,.4,.43)});y-=33;}
  function line(text,font=regular,size=11){if(y<bottom)newPage();page.drawText(text,{x:left,y,size,font});y-=size+5;}
  function wrapped(text,font=regular,size=11){
    try {font.encodeText(text);}catch{throw new Error('PDF-exporten stöder inte alla tecken i händelserna. Använd vanliga bokstäver och symboler (å, ä, ö stöds), eller exportera JSON för att bevara alla tecken.');}
    for(const paragraph of text.replaceAll('\t','    ').split('\n')){
      let current='';
      for(const word of paragraph.split(' ')){
        const candidate=current?current+' '+word:word;
        if(font.widthOfTextAtSize(candidate,size)<=width){current=candidate;continue;}
        if(current)line(current,font,size);current='';
        for(const char of word){if(font.widthOfTextAtSize(current+char,size)>width){line(current,font,size);current='';}current+=char;}
      }
      line(current,font,size);
    }
  }
  newPage();const events=orderedEvents(rows);
  if(!events.length)line('Inga händelser.');
  for(const [index,row] of events.entries()){
    if(y<bottom+95)newPage();
    wrapped(`${index+1}. ${row.event.occurredAt.replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC')}`,bold,12);
    if(row.event.lat!==null)line(`Position: ${row.event.lat.toFixed(6)}, ${row.event.lon.toFixed(6)}`,regular,10);
    if(row.event.depth!=null)line(`Djup: ${row.event.depth.toFixed(2)} m (angivet värde)`,regular,10);
    wrapped(row.event.text);y-=13;
  }
  const pages=doc.getPages();pages.forEach((p,i)=>p.drawText(`Sida ${i+1} av ${pages.length}`,{x:left,y:30,size:9,font:regular,color:rgb(.4,.4,.4)}));
  return doc.save();
}
