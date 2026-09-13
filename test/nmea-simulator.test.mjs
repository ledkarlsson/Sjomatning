import test from 'node:test'
import assert from 'node:assert/strict'
import { simulationFrame } from '../src/nmea-simulator.mjs'
import { parseNmeaSentence } from '../src/nmea-parser.mjs'

test('simulated NMEA survives checksums and parsing over a full circuit', () => {
  const epoch = new Date('2026-09-13T23:59:59Z')
  for (let seconds = 0; seconds < 2400; seconds += 17) {
    const frame = simulationFrame(seconds, epoch)
    const [depth, position] = frame.sentences.map(parseNmeaSentence)
    assert.equal(depth.type, 'depth')
    assert.equal(position.type, 'position')
    assert.ok(Math.abs(position.lat - frame.lat) < 0.000001)
    assert.ok(Math.abs(position.lon - frame.lon) < 0.000001)
    assert.ok(depth.depth > 2 && depth.depth < 8)
    assert.equal(position.speed, 5)
    for (const sentence of frame.sentences) {
      let checksum = 0
      for (const char of sentence.slice(1, -3)) checksum ^= char.charCodeAt(0)
      assert.equal(parseInt(sentence.slice(-2), 16), checksum)
    }
  }
  assert.equal(parseNmeaSentence(simulationFrame(2, epoch).sentences[1]).date, '2026-09-14')
  assert.notEqual(simulationFrame(0, epoch).lat, simulationFrame(60, epoch).lat)
})
