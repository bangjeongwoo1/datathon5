import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersistedPositions, filterStoresInBounds } from '../src/mapPositions.ts'
import { merchants } from '../src/merchants.ts'

test('buildPersistedPositions excludes merchants without saved coordinates', () => {
  const located = merchants.find((merchant) => merchant.coordinates)
  assert.ok(located)
  const missing = { ...located, id: -1, coordinates: undefined }

  const positions = buildPersistedPositions([located, missing])

  assert.equal(positions.size, 1)
  assert.deepEqual(positions.get(located.id), located.coordinates)
  assert.equal(positions.has(missing.id), false)
})

test('filterStoresInBounds returns only stores inside the current map viewport', () => {
  const located = merchants.find((merchant) => merchant.coordinates)
  assert.ok(located)
  const west = { ...located, id: -2, coordinates: { lat: 37.8, lng: 127.6 } }
  const east = { ...located, id: -3, coordinates: { lat: 38.1, lng: 128.1 } }
  const positions = buildPersistedPositions([located, west, east])

  const visible = filterStoresInBounds([located, west, east], positions, {
    south: 37.7, west: 127.5, north: 38, east: 127.9,
  })

  assert.deepEqual(visible.map((merchant) => merchant.id), [located.id, west.id])
})
