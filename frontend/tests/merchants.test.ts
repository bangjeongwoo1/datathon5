import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterMerchants, merchants } from '../src/merchants.ts'

test('searches actual workbook merchants by name, address, and detailed industry', () => {
  const bakery = filterMerchants(merchants, { query: '제과', category: '제과점' })
  assert.ok(bakery.length > 0)
  assert.ok(bakery.every(store => store.category === '베이커리/간식'))
  const address = filterMerchants(merchants, { query: '춘천시', category: '전체' })
  assert.ok(address.length > 4_000)
})

test('filters food stores by their original industry instead of the broad marker category', () => {
  const korean = filterMerchants(merchants, { query: '', category: '한식' })
  const japanese = filterMerchants(merchants, { query: '', category: '일식' })
  assert.ok(korean.length > 0)
  assert.ok(japanese.length > 0)
  assert.ok(korean.every(store => store.rawCategory === '한식' && store.category === '일반음식점'))
  assert.ok(japanese.every(store => store.rawCategory === '일식' && store.category === '일반음식점'))
})

test('returns no match without mutating the generated merchant order', () => {
  const firstId = merchants[0].id
  assert.deepEqual(filterMerchants(merchants, { query: '없는매장검색어', category: '전체' }), [])
  assert.equal(merchants[0].id, firstId)
})
