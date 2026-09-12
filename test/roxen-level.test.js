const test = require('node:test')
const assert = require('node:assert/strict')
const { isoWeek, parseChartData, fetchRoxenLevel } = require('../src/roxen-level')

test('räknar ISO-vecka även över årsskifte', () => {
  assert.deepEqual(isoWeek('2024-01-01'), { year: 2024, week: 1, weekday: 1 })
  assert.deepEqual(isoWeek('2024-12-31'), { year: 2025, week: 1, weekday: 2 })
})

test('väljer rätt dygnsvärde ur diagramdata', () => {
  const chart = { labels: ['mån', 'tis', 'ons'], datasets: [{ label: 'Vattennivå (m ö.h.)', data: ['32.53', '32.54', null] }] }
  assert.equal(parseChartData(chart, '2026-09-01').level, 32.54)
  assert.equal(parseChartData(chart, '2026-09-02'), null)
})

test('skickar vecka och år till Roxens dataendpoint', async () => {
  let request
  const fakeFetch = async (url, options) => {
    request = { url, options }
    return { ok: true, text: async () => JSON.stringify({ labels: Array(7).fill('dag'), datasets: [{ label: 'Vattennivå', data: ['32.50'] }] }) }
  }
  const result = await fetchRoxenLevel('2026-08-31', fakeFetch)
  assert.equal(result.level, 32.5)
  assert.equal(request.options.body.get('lake'), 'roxen')
  assert.equal(request.options.body.get('week'), '36')
})
