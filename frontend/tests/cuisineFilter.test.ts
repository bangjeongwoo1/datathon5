import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesCuisine } from '../src/cuisineFilter.ts'
import { filterMerchants } from '../src/merchants.ts'
import type { MerchantRecord } from '../src/merchantData.ts'

const merchant = (data: Partial<MerchantRecord>): MerchantRecord => ({
  id: 1,
  name: '이름만 일식인 식당',
  address: '춘천시',
  category: '일반음식점',
  rawCategory: '음식점',
  detailCategory: '음식점',
  ...data,
})

test('가게 이름에 일식이 있어도 업종 데이터가 없으면 일식으로 나오지 않는다', () => {
  assert.equal(matchesCuisine(merchant({}), '일식'), false)
})

test('상호명이 일반적이어도 네이버 업종이 라멘이면 일식으로 나온다', () => {
  const shop = merchant({ name: '행복식당', naverCuisine: '라멘 전문점', detailCategory: '라멘 전문점' })
  assert.equal(matchesCuisine(shop, '일식'), true)
})

test('네이버 분류가 공공데이터와 다르면 네이버 세부 업종을 우선한다', () => {
  const shop = merchant({ rawCategory: '한식', detailCategory: '일식', naverCuisine: '일식' })
  assert.equal(matchesCuisine(shop, '일식'), true)
  assert.equal(matchesCuisine(shop, '한식'), false)
})

test('네이버 업종이 없으면 기존 공공데이터의 업종을 사용한다', () => {
  assert.equal(matchesCuisine(merchant({ rawCategory: '중식', detailCategory: '기타' }), '중식'), true)
  assert.equal(matchesCuisine(merchant({ rawCategory: '한식', detailCategory: '분식' }), '분식'), true)
})

test('카테고리 + 음식 종류 + 만원 이하 메뉴 필터가 함께 적용된다', () => {
  const shops = [
    merchant({ id: 1, naverCuisine: '초밥', under10000: 'Y', name: '행복' }),
    merchant({ id: 2, naverCuisine: '일식', under10000: 'N', name: '행복' }),
    merchant({ id: 3, naverCuisine: '중식', under10000: 'Y', name: '행복' }),
  ]
  const result = filterMerchants(shops, { query: '행복', category: '전체', cuisine: '일식', underTenOnly: true })
  assert.deepEqual(result.map(m => m.id), [1])
})

test('기존 큰 범주 필터는 이전과 동일하게 동작한다', () => {
  const shops = [merchant({ id: 1 }), merchant({ id: 2, category: '편의점' })]
  assert.deepEqual(filterMerchants(shops, { query: '', category: '편의점' }).map(m => m.id), [2])
})
