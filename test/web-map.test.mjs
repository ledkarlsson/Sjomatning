import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebMap, geoToMapPixel, mapPixelToGeo, tilesForMap } from '../src/web-map.mjs'

test('Sverigekartan täcker hela landet och kan invertera koordinater', () => {
  const map = createWebMap()
  for (const position of [{ lat: 55.34, lon: 12.84 }, { lat: 57.63, lon: 18.29 }, { lat: 67.85, lon: 20.23 }]) {
    const pixel = geoToMapPixel(map, position.lat, position.lon)
    assert.ok(pixel.x > 0 && pixel.x < map.width)
    assert.ok(pixel.y > 0 && pixel.y < map.height)
    const restored = mapPixelToGeo(map, pixel.x, pixel.y)
    assert.ok(Math.abs(restored.lat - position.lat) < 1e-9)
    assert.ok(Math.abs(restored.lon - position.lon) < 1e-9)
  }
})

test('endast synliga kartplattor begärs', () => {
  const map = createWebMap()
  const tiles = tilesForMap(map)
  assert.ok(tiles.length > 0 && tiles.length < 50)
  assert.equal(new Set(tiles.map(tile => `${tile.x}/${tile.y}`)).size, tiles.length)
})
