let assets;
async function load(){
 if(typeof process!=='undefined'&&process.versions?.node){
  const [{readFile},fontkit]=await Promise.all([import('node:fs/promises'),import('@pdf-lib/fontkit')]);
  return {fontkit:fontkit.default,regular:await readFile(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)),bold:await readFile(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf',import.meta.url))};
 }
 const fontkit=await import('../fontkit.mjs');
 const fetchFont=async name=>{const response=await fetch(new URL('../fonts/'+name,import.meta.url));if(!response.ok)throw new Error('PDF-typsnittet kunde inte laddas. Ladda om sidan och försök igen.');return new Uint8Array(await response.arrayBuffer());};
 return {fontkit:fontkit.default,regular:await fetchFont('LiberationSans-Regular.ttf'),bold:await fetchFont('LiberationSans-Bold.ttf')};
}
export async function pdfFonts(doc){
 assets??=load().catch(error=>{assets=null;throw error;});
 const data=await assets;doc.registerFontkit(data.fontkit);
 const regular=await doc.embedFont(data.regular,{subset:true}),bold=await doc.embedFont(data.bold,{subset:true});
 // Custom fonts otherwise silently render missing glyphs as empty boxes.
 for(const font of [regular,bold]){
  const supported=new Set(font.getCharacterSet()),encode=font.encodeText.bind(font),width=font.widthOfTextAtSize.bind(font);
  const check=text=>{for(const char of text)if(!['\n','\r','\t'].includes(char)&&!supported.has(char.codePointAt(0)))throw new Error(`PDF-typsnittet stöder inte tecknet ${char} (U+${char.codePointAt(0).toString(16).toUpperCase()}). Exportera JSON för att bevara texten.`);};
  font.encodeText=text=>{check(text);return encode(text);};font.widthOfTextAtSize=(text,size)=>{check(text);return width(text,size);};
 }
 return {regular,bold};
}
