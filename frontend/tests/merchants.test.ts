import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merchants, filterMerchants } from '../src/merchants.ts'

test('combines category, delivery, open and text search', () => {
  const result = filterMerchants(merchants, { query: '  김밥  ', category: '일반음식점', open: true, delivery: true, distance: false })
  assert.deepEqual(result.map(s => s.id), [1])
})
test('handles no matches and sorts without changing original data', () => {
  const options = { query: '', category: '전체', open: false, delivery: false, distance: true }
  assert.equal(filterMerchants(merchants, { ...options, query: '없는가게' }).length, 0)
  const result = filterMerchants(merchants, options)
  assert.deepEqual(result.map(s => s.distance), [...result.map(s => s.distance)].sort((a,b) => a-b))
  assert.equal(merchants[0].id, 1)
})

