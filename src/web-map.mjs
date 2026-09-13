export const SWEDEN_BOUNDS = Object.freeze({
  north: 69.1,
  south: 55.2,
  west: 10.4,
  east: 24.3
})

export const SWEDEN_TILE_ZOOM = 6

export const ROXEN_BOUNDS = Object.freeze({
  north: 58.62,
  south: 58.44,
  west: 15.48,
  east: 15.92
})

function clampLatitude(latitude) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude))
}

export function lonToWorldX(longitude, zoom) {
  return ((longitude + 180) / 360) * 256 * (2 ** zoom)
}

export function latToWorldY(latitude, zoom) {
  const radians = clampLatitude(latitude) * Math.PI / 180
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 256 * (2 ** zoom)
}

export function worldYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / (256 * (2 ** zoom))
  return Math.atan(Math.sinh(n)) * 180 / Math.PI
}

export function createWebMap(bounds = SWEDEN_BOUNDS, zoom = SWEDEN_TILE_ZOOM) {
  const left = lonToWorldX(bounds.west, zoom)
  const right = lonToWorldX(bounds.east, zoom)
  const top = latToWorldY(bounds.north, zoom)
  const bottom = latToWorldY(bounds.south, zoom)
  return {
    bounds,
    zoom,
    left,
    top,
    width: Math.ceil(right - left),
    height: Math.ceil(bottom - top),
    minTileX: Math.floor(left / 256),
    maxTileX: Math.floor((right - 1) / 256),
    minTileY: Math.floor(top / 256),
    maxTileY: Math.floor((bottom - 1) / 256)
  }
}

export function geoToMapPixel(map, latitude, longitude) {
  return { x: lonToWorldX(longitude, map.zoom) - map.left, y: latToWorldY(latitude, map.zoom) - map.top }
}

export function mapPixelToGeo(map, x, y) {
  return {
    lon: ((x + map.left) / (256 * (2 ** map.zoom))) * 360 - 180,
    lat: worldYToLat(y + map.top, map.zoom)
  }
}

export function tilesForMap(map) {
  const tiles = []
  for (let y = map.minTileY; y <= map.maxTileY; y += 1) {
    for (let x = map.minTileX; x <= map.maxTileX; x += 1) {
      tiles.push({ x, y, dx: Math.round(x * 256 - map.left), dy: Math.round(y * 256 - map.top) })
    }
  }
  return tiles
}
