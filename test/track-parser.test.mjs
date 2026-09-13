import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTextTrack, parseTrcTrack } from '../src/track-parser.mjs'

test('läser äldre waypoint-TXT och använder rådjupet från Ekolod', () => {
  const text = 'Datum,WGS84,WGS84,0,0,0,0,0\nWP,D,A0001 3.04,58.44898,15.62333,,,Ekolod:4.0'
  const result = parseTextTrack(text, '20240519_33.96_Scilla_Mariagrundet.txt')
  assert.equal(result.points[0].depth, 4)
  assert.equal(result.points[0].lat, 58.44898)
  assert.equal(result.correction, 0.96)
})

test('läser en 30-bytepost ur SeaClear TRC', () => {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, Math.round(58.44898 * 60000), true)
  view.setInt32(4, Math.round(15.62333 * 60000), true)
  view.setUint16(28, 40, true)
  const result = parseTrcTrack(bytes, '20240519_33.96_Scilla_Mariagrundet.TRC')
  assert.equal(result.points[0].lat, 58.44898333333333)
  assert.equal(result.points[0].lon, 15.623333333333333)
  assert.equal(result.points[0].depth, 4)
  assert.equal(result.points[0].date, '2024-05-19')
})

import { parseLowranceTrack } from '../src/track-parser.mjs'
test('SL2 och SL3 konverterar position och fot, väljer ekolodskanaler och varnar vid avkortning', () => {
  for (const format of [2, 3]) {
    const sl2 = format === 2, size = sl2 ? 144 : 168
    const bytes = new Uint8Array(8 + size * 2 + 1)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, format, true)
    for (let i = 0; i < 2; i++) {
      const o = 8 + i * size
      view.setUint16(o + (sl2 ? 28 : 8), size, true)
      view.setUint16(o + (sl2 ? 32 : 12), i === 0 ? 0 : 2, true)
      view.setUint16(o + (sl2 ? 132 : 116), 0x12, true)
      view.setFloat32(o + (sl2 ? 64 : 48), 10, true)
      view.setFloat32(o + (sl2 ? 100 : 84), 3, true)
      view.setInt32(o + (sl2 ? 108 : 92), Math.round(15.6 * Math.PI / 180 * 6356752.3142), true)
      view.setInt32(o + (sl2 ? 112 : 96), Math.round(Math.log(Math.tan(Math.PI / 4 + 58.5 * Math.PI / 360)) * 6356752.3142), true)
    }
    const result = parseLowranceTrack(bytes, `test.sl${format}`)
    assert.equal(result.points.length, 1)
    assert.ok(Math.abs(result.points[0].depth - 3.048) < 1e-9)
    assert.ok(Math.abs(result.points[0].lat - 58.5) < .00001)
    assert.ok(Math.abs(result.points[0].lon - 15.6) < .00001)
    assert.equal(result.points[0].speed, 3)
    assert.equal(result.points[0].date, '')
    assert.equal(result.warnings.length, 1)
    view.setUint16(8 + (sl2 ? 28 : 8), 0, true)
    assert.throws(() => parseLowranceTrack(bytes, 'bad.sl2'), /postlängd/)
  }
})
