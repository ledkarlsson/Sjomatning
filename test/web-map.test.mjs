import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebMap, geoToMapPixel, mapPixelToGeo, tilesForMap } from '../src/web-map.mjs'

test('Roxens webbkarta täcker sjön och kan invertera koordinater', () => {
  const map = createWebMap()
  const position = { lat: 58.48687, lon: 15.67577 }
  const pixel = geoToMapPixel(map, position.lat, position.lon)
  assert.ok(pixel.x > 0 && pixel.x < map.width)
  assert.ok(pixel.y > 0 && pixel.y < map.height)
  const restored = mapPixelToGeo(map, pixel.x, pixel.y)
  assert.ok(Math.abs(restored.lat - position.lat) < 1e-9)
  assert.ok(Math.abs(restored.lon - position.lon) < 1e-9)
})

test('endast synliga kartplattor begärs', () => {
  const map = createWebMap()
  const tiles = tilesForMap(map)
  assert.ok(tiles.length > 0 && tiles.length < 100)
  assert.equal(new Set(tiles.map(tile => `${tile.x}/${tile.y}`)).size, tiles.length)
})
