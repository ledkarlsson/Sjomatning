const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMeasurementLog, waterLevelFromName } = require('../src/log-parser')

test('läser SeaClear-rader med dubbla CR-radslut', () => {
  const text = '2024-07-16,09:09:23, 58.48687,15.67577, 0.9,4.6\r\r\n2024-07-16,09:09:25, 58.48685,15.67578, 0.9,4.5\r\r\n'
  const result = parseMeasurementLog(text, '20240716_33.53_Pioner_Husholmen_trace.TXT')
  assert.equal(result.points.length, 2)
  assert.equal(result.warnings.length, 0)
  assert.equal(result.correction, 0.53)
  assert.equal(result.points[0].lat, 58.48687)
})

test('hoppar över trasiga rader och rapporterar dem', () => {
  const text = 'skräp\n2024-08-03,16:56:02,58.48840,15.67428,1.4,5.4'
  const result = parseMeasurementLog(text, 'logg.txt')
  assert.equal(result.points.length, 1)
  assert.equal(result.warnings.length, 1)
})

test('läser vattenstånd från filnamnet', () => {
  assert.equal(waterLevelFromName('20240803_33.83_Scilla_Husholmen_trace.TXT'), 33.83)
  assert.equal(waterLevelFromName('annan.txt'), null)
})
