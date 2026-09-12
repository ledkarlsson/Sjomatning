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

async function fetchRoxenLevel(dateString, fetchImpl = fetch) {
  const { year, week } = isoWeek(dateString)
  const body = new URLSearchParams({ lake: 'roxen', resolution: 'day', year: String(year), week: String(week) })
  const response = await fetchImpl(ROXEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body,
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Datakällan svarade med HTTP ${response.status}.`)
  const chartData = JSON.parse(await response.text())
  return parseChartData(chartData, dateString)
}

module.exports = { ROXEN_ENDPOINT, fetchRoxenLevel, isoWeek, parseChartData }
