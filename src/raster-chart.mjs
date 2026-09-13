// BSB RLE layout: https://libbsb.sourceforge.net/bsb_file_format.html
// WCI v1/6-bit layout is validated against the local SeaClear fixtures.
const text = bytes => new TextDecoder('windows-1252').decode(bytes)
function check(ok, message) { if (!ok) throw new Error(message) }
function dimensions(width, height) {
  check(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 32767 && height <= 32767, 'Ogiltig kartstorlek')
}
export function readRasterChart(bytes, name) {
  if (/\.wci$/i.test(name)) {
    check(bytes.length >= 20 && text(bytes.subarray(0, 3)) === 'WCI' && bytes[3] === 1 && bytes[4] === 6, 'WCI-varianten stöds inte (kräver version 1, 6-bitars palett)')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint16(12, true), height = view.getUint16(14, true), metadata = view.getUint32(16, true)
    dimensions(width, height)
    const paletteStart = metadata - bytes[5] * 3
    check(bytes[5] > 0 && bytes[5] <= 64 && paletteStart >= 20 + height * 4 && metadata < bytes.length, 'Skadad WCI-header')
    const header = text(bytes.subarray(metadata))
    check(/^GD=WGS84\r?$/m.test(header) && /^PR=2\r?$/m.test(header) && /^DS=0,0\r?$/m.test(header), 'WCI-kartans datum eller projektion stöds inte')
    const refs = [...header.matchAll(/^C\d+=([\d.+-]+),([\d.+-]+),([\d.+-]+),([\d.+-]+)/gm)].map(m => ({ x: +m[1] / width, y: +m[2] / height, lat: +m[3], lon: +m[4] }))
    const boundary = [...header.matchAll(/^B\d+=([\d.+-]+),([\d.+-]+)/gm)].map(m=>({lat:+m[1],lon:+m[2]}))
    return { boundary, type: 'wci', width, height, refs, paletteStart, paletteSize: bytes[5], bytes, geometry: chartGeometry(refs) }
  }
  let end = -1
  for (let i = 0; i < Math.min(bytes.length - 1, 1000000); i++) if (bytes[i] === 26 && bytes[i + 1] === 0) { end = i; break }
  check(end >= 0, 'KAP saknar bildheader')
  const header = text(bytes.subarray(0, end)).replace(/\r?\n +/g, ',')
  const size = header.match(/RA=(\d+),(\d+)/)
  check(size, 'KAP saknar bildstorlek')
  const width = +size[1], height = +size[2]; dimensions(width, height)
  check(/VER\/[123](?:\.|\r|\n)/.test(header), 'Endast BSB/KAP version 1–3 stöds')
  check(/GD=WGS\s?84(?:,|\r|\n)/.test(header), 'KAP kräver WGS84')
  check(/PR=(TRANSVERSE MERCATOR|MERCATOR)(?:,|\r|\n)/.test(header), 'KAP-projektionen stöds inte')
  const refs = [...header.matchAll(/^REF\/\d+,([\d.+-]+),([\d.+-]+),([\d.+-]+),([\d.+-]+)/gm)].map(m => ({ x: +m[1] / width, y: +m[2] / height, lat: +m[3], lon: +m[4] }))
  const palette = []
  for (const m of header.matchAll(/^RGB\/(\d+),(\d+),(\d+),(\d+)/gm)) palette[+m[1]] = [+m[2], +m[3], +m[4]]
  const bits = bytes[end + 2]
  check(bits > 0 && bits < 8, 'Ogiltig KAP-palett')
  const boundary = [...header.matchAll(/^PLY\/\d+,([\d.+-]+),([\d.+-]+)/gm)].map(m=>({lat:+m[1],lon:+m[2]}))
  const shift = header.match(/^DTM\/([\d.+-]+),([\d.+-]+)/m)
  check(!shift || (+shift[1]===0 && +shift[2]===0), 'KAP med datumförskjutning stöds inte')
  return { boundary, type: 'kap', width, height, refs, palette, bits, dataStart: end + 3, bytes, geometry: chartGeometry(refs) }
}
// Quadratic calibration for the 3x3 KAP reference grid; bilinear for four WCI controls.
// This is a local reference-point interpolation, not general datum conversion.
export function chartGeometry(refs) {
  const terms = refs.length >= 6 ? (x,y) => [1,x,y,x*y,x*x,y*y] : (x,y) => [1,x,y,x*y]
  const n = terms(0,0).length
  check(refs.length >= n && refs.every(p => [p.x,p.y,p.lat,p.lon].every(Number.isFinite)), 'Otillräcklig kartkalibrering')
  function fit(field) {
    const matrix = Array.from({length:n}, () => Array(n+1).fill(0))
    for (const p of refs) { const t = terms(p.x,p.y); for (let i=0;i<n;i++) { for(let j=0;j<n;j++) matrix[i][j] += t[i]*t[j]; matrix[i][n] += t[i]*p[field] } }
    for(let i=0;i<n;i++) {
      let pivot=i; for(let j=i+1;j<n;j++) if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i])) pivot=j
      ;[matrix[i],matrix[pivot]]=[matrix[pivot],matrix[i]]
      check(Math.abs(matrix[i][i])>1e-14, 'Ogiltig kartkalibrering')
      const d=matrix[i][i]; for(let j=i;j<=n;j++) matrix[i][j]/=d
      for(let r=0;r<n;r++) if(r!==i) { const f=matrix[r][i]; for(let j=i;j<=n;j++) matrix[r][j]-=f*matrix[i][j] }
    }
    return matrix.map(row=>row[n])
  }
  const lat=fit('lat'),lon=fit('lon')
  return (x,y) => { const t=terms(x,y); return {lat:t.reduce((s,v,i)=>s+v*lat[i],0),lon:t.reduce((s,v,i)=>s+v*lon[i],0)} }
}
export async function rasterPixels(chart, maxSide = 3000) {
  const { bytes, width, height } = chart
  const scale = Math.min(1, maxSide / Math.max(width,height)), outWidth = Math.max(1,Math.round(width*scale)), outHeight = Math.max(1,Math.round(height*scale))
  const rgba = new Uint8ClampedArray(outWidth*outHeight*4)
  const palette = chart.type === 'kap' ? chart.palette : Array.from({length:chart.paletteSize}, (_,i)=>Array.from(bytes.subarray(chart.paletteStart+i*3,chart.paletteStart+i*3+3)))
  let cursor = chart.dataStart, rowBase = null
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let targetRow=0
  for(let y=0;y<height;y++) {
    const wanted = targetRow<outHeight && y===Math.floor(targetRow*height/outHeight)
    const row = wanted ? new Uint8Array(width) : null
    if(chart.type==='wci') {
      if(!wanted) continue
      const entry=view.getUint32(20+y*4,true), mode=entry>>>30, offset=entry&0x3fffffff
      if(mode===3) { check(offset<palette.length,'Ogiltig WCI-färg'); row.fill(offset) }
      else {
        check(offset>=20+height*4 && offset<chart.paletteStart,'Ogiltigt WCI-radindex')
        let end=chart.paletteStart
        for(let next=y+1;next<height;next++) { const v=view.getUint32(20+next*4,true); if((v>>>30)!==3) { end=v&0x3fffffff; break } }
        check(end>offset && end<=chart.paletteStart,'Skadad WCI-rad')
        if(mode===0) {
          const stream=new Blob([bytes.subarray(offset,end)]).stream().pipeThrough(new DecompressionStream('deflate'))
          const reader=stream.getReader(); let x=0
          try { while(true) { const {value,done}=await reader.read(); if(done) break; check(x+value.length<=width,'För lång WCI-rad'); row.set(value,x); x+=value.length } } finally { await reader.cancel() }
          check(x===width,'Avkortad WCI-rad')
        } else {
          check(mode===1,'WCI-radkodningen stöds inte')
          let x=0,p=offset
          while(p<end && x<width) {
            const value=bytes[p++],color=(value&127)>>>1
            let length=(value&1)+1
            if(value&128) { check(p+(value&1)<end,'Avkortad WCI-serie'); length=bytes[p++]; if(value&1) length=length*256+bytes[p++]; length++ }
            check(color<palette.length && x+length<=width,'Ogiltig WCI-serie'); row.fill(color,x,x+length); x+=length
          }
          check(x===width && p===end,'Fel längd på WCI-rad')
        }
      }
    } else {
      const read=()=> { check(cursor<bytes.length,'Avkortad KAP'); return bytes[cursor++] }
      let rowNumber=0,value
      do { value=read(); rowNumber=rowNumber*128+(value&127); check(rowNumber<=height,'Ogiltigt KAP-radnummer') } while(value&128)
      if(rowBase===null) { rowBase=rowNumber; check(rowBase===0 || rowBase===1,'Ogiltig första KAP-rad') }
      check(rowNumber===y+rowBase,'KAP-rader saknas')
      let x=0
      while((value=read())!==0) {
        const color=(value&127)>>(7-chart.bits)
        let length=value&((1<<(7-chart.bits))-1),count=0
        while(value&128) { value=read(); length=length*128+(value&127); check(++count<=4,'Ogiltig KAP-serie') }
        length++; check(palette[color] && x+length<=width,'Ogiltig KAP-serie')
        if(row) row.fill(color,x,x+length); x+=length
      }
      check(x===width,'Fel längd på KAP-rad')
    }
    if(wanted) {
      for(let x=0;x<outWidth;x++) { const color=palette[row[Math.floor(x*width/outWidth)]]; check(color,'Ogiltig palettfärg'); const p=(targetRow*outWidth+x)*4; rgba[p]=color[0];rgba[p+1]=color[1];rgba[p+2]=color[2];rgba[p+3]=255 }
      targetRow++
    }
  }
  return { width:outWidth,height:outHeight,rgba }
}
