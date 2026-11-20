import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRegionMerchants } from '../src/merchantApi.ts'

const row = (merchant_id: string | number, name: string) => ({
  merchant_id,
  region: '춘천시',
  name,
  address: '강원특별자치도 춘천시 중앙로 33',
  latitude: 37.88,
  longitude: 127.72,
  category: '음식점',
  source_category_code: null,
  phone: null,
})

test('가맹점을 불러올 때 DB의 merchant_id를 문자열로 유지한다', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ total: 2, merchants: [row(101, '윤식당'), row('CC-000002', '윤수산')] }))

  try {
    const stores = await loadRegionMerchants('춘천시')
    assert.deepEqual(
      stores.map(s => [s.id, s.merchantId, s.name]),
      [
        [1, '101', '윤식당'], // 숫자로 와도 문자열로 통일
        [2, 'CC-000002', '윤수산'],
      ],
    )
  } finally {
    globalThis.fetch = original
  }
})

test('만원 이하 필터: Y 인 가게만 남기고, N·모름(값 없음)은 제외한다', async () => {
  const { filterMerchants } = await import('../src/merchants.ts')
  const base = { address: '', category: '일반음식점', rawCategory: '한식', detailCategory: '한식' }
  const items = [
    { ...base, id: 1, name: '가', under10000: 'Y' },
    { ...base, id: 2, name: '나', under10000: 'N' },
    { ...base, id: 3, name: '다' },
  ] as Parameters<typeof filterMerchants>[0]
  assert.deepEqual(filterMerchants(items, { query: '', category: '전체', underTenOnly: true }).map(s => s.id), [1])
  assert.equal(filterMerchants(items, { query: '', category: '전체' }).length, 3)
  assert.equal(filterMerchants(items, { query: '', category: '전체', underTenOnly: false }).length, 3)
})
