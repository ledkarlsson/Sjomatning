const { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = require('pdf-lib')

function validateAnnotations(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Ogiltiga anteckningar.')
  const ids = new Set()
  return value.map(note => {
    if (!note || typeof note.id !== 'string' || !note.id || ids.has(note.id) || note.id.length > 100 ||
        !Number.isInteger(note.page) || note.page < 1 || note.page > 10000 ||
        !Number.isFinite(note.x) || note.x < 0 || note.x > 1 || !Number.isFinite(note.y) || note.y < 0 || note.y > 1 ||
        !Number.isFinite(note.size) || note.size < 6 || note.size > 72 || !/^#[0-9a-f]{6}$/i.test(note.color) ||
        typeof note.text !== 'string' || !note.text.trim() || note.text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note.text)) throw new Error('Ogiltig anteckning.')
    ids.add(note.id)
    return { id: note.id, page: note.page, x: note.x, y: note.y, text: note.text.replace(/\r\n?/g, '\n'), size: note.size, color: note.color }
  })
}

function displayPosition(page, x, y) {
  const crop = page.getCropBox(), media = page.getMediaBox()
  const left = Math.max(crop.x, media.x), bottom = Math.max(crop.y, media.y)
  const right = Math.min(crop.x + crop.width, media.x + media.width), top = Math.min(crop.y + crop.height, media.y + media.height)
  const w = right-left, h = top-bottom, angle = ((page.getRotation().angle % 360) + 360) % 360
  if (w <= 0 || h <= 0) throw new Error('PDF-sidan har ogiltig beskärning.')
  if (angle === 0) return {x:left+x*w,y:top-y*h,angle}
  if (angle === 90) return {x:left+y*w,y:bottom+x*h,angle}
  if (angle === 180) return {x:right-x*w,y:bottom+y*h,angle}
  if (angle === 270) return {x:right-y*w,y:top-x*h,angle}
  throw new Error('PDF-sidans rotation stöds inte.')
}

async function exportAnnotatedManuscript(file) {
  const notes = validateAnnotations(file.annotations || [])
  let pdf
  if (/\.pdf$/i.test(file.name)) pdf = await PDFDocument.load(file.bytes)
  else if (/\.(kap|wci)$/i.test(file.name)) {
    const { readRasterChart, rasterPixels } = await import('./raster-chart.mjs')
    const chart = readRasterChart(new Uint8Array(file.bytes), file.name)
    // Preserve every source pixel in raster exports, independently of preview size.
    const pixels = await rasterPixels(chart, 32767)
    const data = new Uint8Array(pixels.width * pixels.height * 3)
    for (let i=0,j=0;i<pixels.rgba.length;i+=4) { data[j++]=pixels.rgba[i];data[j++]=pixels.rgba[i+1];data[j++]=pixels.rgba[i+2] }
    pdf = await PDFDocument.create()
    const page = pdf.addPage([pixels.width*72/300,pixels.height*72/300])
    const image = pdf.context.register(pdf.context.flateStream(data, { Type:'XObject',Subtype:'Image',Width:pixels.width,Height:pixels.height,ColorSpace:'DeviceRGB',BitsPerComponent:8 }))
    const key = page.node.newXObject('Manuscript', image)
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(page.getWidth(),0,0,page.getHeight(),0,0), drawObject(key), popGraphicsState())
  } else throw new Error('Filen är inte ett fältmanus.')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const note of notes) {
    if (note.page > pdf.getPageCount()) throw new Error('Anteckningen hänvisar till en sida som saknas.')
    const page = pdf.getPage(note.page-1), position = displayPosition(page,note.x,note.y)
    const color = rgb(...[1,3,5].map(start=>parseInt(note.color.slice(start,start+2),16)/255))
    try {
      page.drawText(note.text,{...position,size:note.size,font,color,rotate:degrees(position.angle),lineHeight:note.size*1.25})
    } catch(error) {
      throw new Error(`Anteckningen ”${note.text.slice(0,40)}” kan inte exporteras. Använd vanliga bokstäver och siffror (å, ä och ö stöds).`, {cause:error})
    }
  }
  // Keep geographic dictionaries readable by the existing GeoPDF importer.
  return pdf.save({useObjectStreams:false})
}
module.exports = { validateAnnotations, displayPosition, exportAnnotatedManuscript }
