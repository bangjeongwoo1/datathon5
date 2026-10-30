import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersistedPositions } from '../src/mapPositions.ts'
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
