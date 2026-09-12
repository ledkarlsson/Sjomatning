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
