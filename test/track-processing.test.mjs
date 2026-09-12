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
  assert.match(exportWaypoints([track]), /A0001 4\.60/)
  assert.match(exportWaypoints([track]), /Ekolod:5\.00/)
})

test('datum hämtas först från filnamnsmetadata och annars från mätpunkten', () => {
  assert.equal(trackDate({ date: '2026-09-11', points: [point(15.6, 5)] }), '2026-09-11')
  assert.equal(trackDate({ points: [point(15.6, 5)] }), '2026-09-12')
  assert.equal(trackDate({ points: [{ ...point(15.6, 5), date: '' }] }), null)
})
