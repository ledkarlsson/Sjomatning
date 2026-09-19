export function validateEdits(edits) {
  if (edits === null) return null;
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw new Error('Ogiltiga spårändringar.');
  const result = {};
  for (const key of ['waterLevel','correction','depthAdjustment','pruneDistance']) {
    if (edits[key] !== undefined) {
      if (edits[key] !== null && !Number.isFinite(edits[key])) throw new Error('Ogiltigt djupvärde.');
      result[key] = edits[key];
    }
  }
  for (const key of ['waterLevelSource','waterLevelDate']) if (edits[key] !== undefined) {
    if (edits[key] !== null && (typeof edits[key] !== 'string' || edits[key].length > 100)) throw new Error('Ogiltig vattennivåkälla.');
    result[key] = edits[key];
  }
  if (edits.points !== undefined) {
    if (!Array.isArray(edits.points)) throw new Error('Ogiltiga punkter.');
    result.points = edits.points.map(point => {
      if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat)>90 || !Number.isFinite(point.lon) || Math.abs(point.lon)>180) throw new Error('Ogiltig koordinat.');
      const p = { lat:point.lat, lon:point.lon };
      for (const key of ['depth','speed']) { if (point[key] != null && !Number.isFinite(point[key])) throw new Error('Ogiltigt punktvärde.'); p[key] = point[key] ?? null; }
      for (const key of ['date','time']) { if (point[key] != null && (typeof point[key] !== 'string' || point[key].length>100)) throw new Error('Ogiltig tid.'); p[key] = point[key] || ''; }
      if (Number.isInteger(point.coordinateDecimals) && point.coordinateDecimals >= 0 && point.coordinateDecimals <= 15) p.coordinateDecimals = point.coordinateDecimals;
      if (point.coordinateText && ['lat','lon'].every(k => typeof point.coordinateText[k] === 'string' && /^-?\d+(?:\.\d+)?$/.test(point.coordinateText[k]) && point.coordinateText[k].length <= 30)) p.coordinateText = { lat:point.coordinateText.lat, lon:point.coordinateText.lon };
      return p;
    });
  }
  return result;
}
export function validateNotes(notes) {
  if (!Array.isArray(notes) || notes.length > 10000) throw new Error('Ogiltiga anteckningar.');
  return notes.map(note => {
    if (!note || typeof note.id !== 'string' || note.id.length > 100 || !Number.isInteger(note.page) || note.page < 1 || !Number.isFinite(note.x) || note.x<0 || note.x>1 || !Number.isFinite(note.y) || note.y<0 || note.y>1 || !Number.isFinite(note.size) || note.size<6 || note.size>72 || !/^#[a-f0-9]{6}$/i.test(note.color) || typeof note.text !== 'string' || !note.text.trim() || note.text.length>2000) throw new Error('Ogiltig anteckning.');
    return { id:note.id, page:note.page, x:note.x, y:note.y, size:note.size, color:note.color, text:note.text };
  });
}
