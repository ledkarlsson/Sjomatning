import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNmeaSentence } from '../src/nmea-parser.mjs'

test('läser GPS-position och fart ur RMC', () => {
  const result = parseNmeaSentence('$GPRMC,090923.00,A,5829.2122,N,01540.5462,E,0.9,0.0,160724,,,A')
  assert.equal(result.type, 'position')
  assert.equal(result.date, '2024-07-16')
  assert.ok(Math.abs(result.lat - 58.48687) < 0.00001)
  assert.ok(Math.abs(result.lon - 15.67577) < 0.00001)
  assert.equal(result.speed, 0.9)
})

test('läser ekolodsdjup ur DPT och DBT', () => {
  assert.deepEqual(parseNmeaSentence('$SDDPT,4.6,0.3'), { type: 'depth', depth: 4.6, instrumentOffset: 0.3 })
  assert.deepEqual(parseNmeaSentence('$SDDBT,15.1,f,4.6,M,2.5,F'), { type: 'depth', depth: 4.6, instrumentOffset: 0 })
})

test('avvisar en felaktig checksumma', () => {
  assert.equal(parseNmeaSentence('$GPRMC,1,A,1,N,1,E,0,0,010101*00'), null)
})
