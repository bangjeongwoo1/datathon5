import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapCandidateStores, toMerchant, toUiCategory } from '../src/merchantData.ts'

test('maps workbook industries to truthful UI categories', () => {
  assert.equal(toUiCategory('편의점'), '편의점')
  assert.equal(toUiCategory('제과점'), '베이커리/간식')
  assert.equal(toUiCategory('한식'), '일반음식점')
  assert.equal(toUiCategory('농협(마트)'), '마트')
})

test('preserves source fields and falls back when official business type is blank', () => {
  const merchant = toMerchant({ id: 9, name: '테스트 제과점', address: '강원특별자치도 춘천시 중앙로 1', industry: '제과점', officialBusinessType: '' })
  assert.deepEqual(merchant, {
    id: 9,
    name: '테스트 제과점',
    address: '강원특별자치도 춘천시 중앙로 1',
    category: '베이커리/간식',
    rawCategory: '제과점',
    detailCategory: '제과점',
  })
})

test('keeps the selected merchant in the bounded map candidate set', () => {
  const stores = Array.from({ length: 90 }, (_, index) => ({ id: index + 1 }))
  const candidates = mapCandidateStores(stores, 90, 60)
  assert.equal(candidates.length, 60)
  assert.ok(candidates.some(store => store.id === 90))
})
