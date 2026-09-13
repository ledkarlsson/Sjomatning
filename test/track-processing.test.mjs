import test from 'node:test'
import assert from 'node:assert/strict'
import { adjustedDepth, exportCsv, exportWaypoints, prunePoints, trackDate } from '../src/track-processing.mjs'

const point = (lon, depth) => ({ date: '2026-09-12', time: '10:00:00', lat: 58.48, lon, speed: 2, depth })

test('glesning behåller ändpunkter och viktig grundaste mellanpunkt', () => {
  const points = [point(15.60, 5), point(15.6001, 4.8), point(15.6002, 2), point(15.6005, 5)]
  const result = prunePoints(points, 25)
  assert.deepEqual(result.map(item => item.depth), [5, 2, 5])
})

test('noll meter lämnar råpunkterna orörda', () => {
  const points = [point(15.60, 5), point(15.61, 4)]
  assert.deepEqual(prunePoints(points, 0), points)
})

test('vattenstånd och separat djupjustering kombineras per spår', () => {
  assert.equal(adjustedDepth({ correction: .53, depthAdjustment: -.1 }, point(15.6, 5)), 4.37)
})

test('CSV- och waypointexport använder bearbetade justerade värden', () => {
  const track = { name: 'Körning 1', points: [point(15.6, 5)], correction: .5, depthAdjustment: .1, pruneDistance: 25 }
  assert.match(exportCsv([track]), /4\.60/)
  assert.equal(exportCsv([track]).charCodeAt(0), 0xFEFF)
  assert.ok(exportCsv([track]).includes('Körning 1'))
  assert.match(exportWaypoints([track]), /A0001 4\.60/)
  assert.match(exportWaypoints([track]), /Ekolod:5\.00/)
})

test('datum hämtas först från filnamnsmetadata och annars från mätpunkten', () => {
  assert.equal(trackDate({ date: '2026-09-11', points: [point(15.6, 5)] }), '2026-09-11')
  assert.equal(trackDate({ points: [point(15.6, 5)] }), '2026-09-12')
  assert.equal(trackDate({ points: [{ ...point(15.6, 5), date: '' }] }), null)
})

import { compareTrackPoints } from '../src/track-processing.mjs'
test('jämför närliggande punkter med korrigering och utesluter avlägsna punkter', () => {
  const reference = { points: [point(15.6, 5)], correction: .5 }
  const track = { points: [point(15.60001, 6), point(16, 2)], depthAdjustment: -.2 }
  const pairs = compareTrackPoints(reference, track, 10)
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].referenceIndex, 0)
  assert.ok(Math.abs(pairs[0].delta - 1.3) < 1e-9)
  assert.ok(pairs[0].distance < 1)
  assert.deepEqual(compareTrackPoints({ points: [] }, track), [])
})
