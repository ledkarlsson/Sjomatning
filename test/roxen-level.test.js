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
const { fetchLatestRoxenLevel } = require('../src/roxen-level')

function chartResponse(data) {
  return { ok: true, text: async () => JSON.stringify({ datasets: [{ label: 'Vattennivå', data }] }) }
}

test('senaste nivå hoppar över luckor och framtida dagar', async () => {
  const result = await fetchLatestRoxenLevel(async () => chartResponse([32.5, null, '', 32.8]), '2026-09-02')
  assert.equal(result.date, '2026-08-31')
  assert.equal(result.level, 32.5)
})

test('senaste nivå söker föregående vecka över årsskifte', async () => {
  const requests = []
  const result = await fetchLatestRoxenLevel(async (_url, options) => {
    requests.push([options.body.get('year'), options.body.get('week')])
    return chartResponse(requests.length === 1 ? [] : [null, null, null, null, null, null, 32.7])
  }, '2024-12-30')
  assert.deepEqual(requests, [['2025', '1'], ['2024', '52']])
  assert.equal(result.date, '2024-12-29')
  assert.equal(result.level, 32.7)
})

test('senaste nivå avslutar om källan saknar aktuella värden', async () => {
  let requests = 0
  const result = await fetchLatestRoxenLevel(async () => { requests += 1; return chartResponse([]) }, '2026-09-02')
  assert.equal(result, null)
  assert.equal(requests, 8)
})
