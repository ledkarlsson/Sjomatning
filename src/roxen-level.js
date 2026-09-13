const ROXEN_ENDPOINT = 'https://gamla.tekniskaverken.se/Script/GetChartData'

function isoWeek(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw new Error('Ogiltigt datum.')
  const date = new Date(`${dateString}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateString) throw new Error('Ogiltigt datum.')
  const target = new Date(date)
  const weekday = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - weekday)
  const year = target.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7)
  return { year, week, weekday }
}

function parseChartData(chartData, dateString) {
  const { weekday } = isoWeek(dateString)
  const dataset = chartData?.datasets?.find(item => item.label?.includes('Vattennivå'))
  const rawLevel = dataset?.data?.[weekday - 1]
  const level = rawLevel == null || rawLevel === '' ? null : Number(rawLevel)
  if (!Number.isFinite(level)) return null
  return {
    date: dateString,
    level,
    label: chartData.labels?.[weekday - 1] || dateString,
    referenceSystem: 'RH00',
    sourceUrl: 'https://gamla.tekniskaverken.se/om-oss/vad-vi-gor/vattenkraft/vattenniva/?lake=roxen&period=day#waterlevels'
  }
}

async function fetchChart(dateString, fetchImpl) {
  const { year, week } = isoWeek(dateString)
  const body = new URLSearchParams({ lake: 'roxen', resolution: 'day', year: String(year), week: String(week) })
  const response = await fetchImpl(ROXEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Datakällan svarade med HTTP ${response.status}.`)
  return JSON.parse(await response.text())
}

async function fetchRoxenLevel(dateString, fetchImpl = fetch) {
  return parseChartData(await fetchChart(dateString, fetchImpl), dateString)
}

async function fetchLatestRoxenLevel(fetchImpl = fetch, dateString = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })) {
  isoWeek(dateString)
  const day = new Date(`${dateString}T12:00:00Z`)
  // Search recent weekly charts without requesting the same week for each day.
  for (let weeks = 0; weeks < 8; weeks += 1) {
    const date = day.toISOString().slice(0, 10)
    const chart = await fetchChart(date, fetchImpl)
    const { weekday } = isoWeek(date)
    for (let index = weekday; index > 0; index -= 1) {
      const result = parseChartData(chart, day.toISOString().slice(0, 10))
      if (result) return result
      day.setUTCDate(day.getUTCDate() - 1)
    }
  }
  return null
}

module.exports = { ROXEN_ENDPOINT, fetchRoxenLevel, fetchLatestRoxenLevel, isoWeek, parseChartData }
