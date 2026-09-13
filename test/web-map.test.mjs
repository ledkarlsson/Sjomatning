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


import { ROXEN_BOUNDS, SWEDEN_BOUNDS, fitBounds, panMap, zoomMap, visibleTiles, viewportMap } from '../src/web-map.mjs'

test('Roxen starts inside a full viewport and Sweden fits after zooming out', () => {
  for (const [width, height] of [[700, 550], [1400, 900]]) {
    for (const bounds of [ROXEN_BOUNDS, SWEDEN_BOUNDS]) {
      const map = fitBounds(bounds, width, height)
      for (const [lat, lon] of [[bounds.north, bounds.west], [bounds.south, bounds.east]]) {
        const point = geoToMapPixel(map, lat, lon)
        assert.ok(point.x >= 20 && point.x <= width - 20)
        assert.ok(point.y >= 20 && point.y <= height - 20)
      }
    }
  }
})

test('dragging beyond the original Roxen crop requests new tiles in every direction', () => {
  const map = fitBounds(ROXEN_BOUNDS, 1000, 700)
  const original = new Set(visibleTiles(map).map(t => `${t.zoom}/${t.x}/${t.y}`))
  for (const [dx, dy] of [[2000, 0], [-2000, 0], [0, 2000], [0, -2000]]) {
    const moved = panMap(map, dx, dy)
    const point = geoToMapPixel(moved, 58.53, 15.7)
    const before = geoToMapPixel(map, 58.53, 15.7)
    assert.ok(Math.abs(point.x - before.x - dx) < 1e-7)
    assert.ok(Math.abs(point.y - before.y - dy) < 1e-7)
    assert.ok(visibleTiles(moved).some(t => !original.has(`${t.zoom}/${t.x}/${t.y}`)))
  }
})

test('zoom preserves the coordinate under the pointer and supports Sweden-scale views', () => {
  let map = fitBounds(ROXEN_BOUNDS, 1000, 700)
  const anchor = mapPixelToGeo(map, 173, 421)
  for (const zoom of [12.4, 8, 5, 11]) {
    map = zoomMap(map, zoom, 173, 421)
    const point = geoToMapPixel(map, anchor.lat, anchor.lon)
    assert.ok(Math.abs(point.x - 173) < 1e-7)
    assert.ok(Math.abs(point.y - 421) < 1e-7)
  }
})

test('tiles cover the viewport without gaps at fractional zoom and after resize', () => {
  for (const zoom of [3, 5.8, 11.3, 18]) {
    const map = viewportMap({ lat: 58.53, lon: 15.7 }, zoom, 1430, 870)
    const tiles = visibleTiles(map)
    assert.ok(tiles.length < 50)
    for (let y = 0; y < map.height; y += 31) {
      for (let x = 0; x < map.width; x += 31) {
        assert.ok(tiles.some(t => x >= t.dx && x < t.dx + t.size && y >= t.dy && y < t.dy + t.size))
      }
    }
  }
})
