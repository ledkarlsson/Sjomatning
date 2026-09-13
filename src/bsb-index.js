const path = require('node:path')
const fs = require('node:fs/promises')

async function expandChartIndexes(files, readSurveyFile) {
  const result = files.filter(file => !/\.bsb$/i.test(file.name))
  for (const file of files.filter(file => /\.bsb$/i.test(file.name))) {
    const header = new TextDecoder('windows-1252').decode(file.bytes)
    const references = [...header.matchAll(/FN=([^,\r\n]+)/g)].map(match => match[1].trim())
    if (!references.length) throw new Error(`${file.name}: BSB-indexet saknar KAP-filer.`)
    const directory = path.dirname(file.path)
    const entries = await fs.readdir(directory)
    for (const name of references) {
      if (path.basename(name) !== name || /[\\/]/.test(name) || !/\.kap$/i.test(name)) throw new Error(`${file.name}: ogiltig KAP-referens.`)
      const actual = entries.find(entry => entry.toLowerCase() === name.toLowerCase())
      if (!actual) throw new Error(`${file.name}: saknar ${name}. Lägg KAP-filen i samma mapp.`)
      const chart = await readSurveyFile(path.join(directory, actual))
      if (!result.some(item => item.id === chart.id)) result.push(chart)
    }
  }
  return result
}

module.exports = { expandChartIndexes }
