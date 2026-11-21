import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterMerchants } from '../src/merchants.ts'
import { merchants } from './sourceMerchants.ts'

test('returns no match without mutating the generated merchant order', () => {
  const firstId = merchants[0].id
  assert.deepEqual(filterMerchants(merchants, { query: '없는매장검색어', category: '전체' }), [])
  assert.equal(merchants[0].id, firstId)
})
