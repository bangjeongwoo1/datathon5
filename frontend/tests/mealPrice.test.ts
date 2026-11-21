import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfirmedMeals, mealsWithinBudget } from '../src/mealPrice.ts'
import { loadRegionMerchants } from '../src/merchantApi.ts'

test('accepts only usable approved meal rows and applies the inclusive budget boundary', () => {
  const meals = parseConfirmedMeals([
    { name: ' 비빔밥 ', price: 9000 }, { name: '정식', price: 10000 },
    { name: '특선', price: 11000 }, { name: '시연', price: 1000, preview: true },
    { name: '', price: 7000 }, { name: '미확인', price: null },
    { name: '오류', price: -1 }, { name: '문자열', price: '5000' }, null,
  ])
  assert.equal(meals.length, 3)
  assert.deepEqual(mealsWithinBudget(meals, 10000).map(m => m.name), ['비빔밥', '정식'])
  assert.deepEqual(parseConfirmedMeals(null), [])
})

test('merchant paging retains main review/menu identifiers and approved menu facts for voice search', async () => {
  const originalFetch = globalThis.fetch
  const offsets: string[] = []
  globalThis.fetch = async input => {
    const offset = new URL(String(input)).searchParams.get('offset')!
    offsets.push(offset)
    const row = {
      merchant_id: offset === '0' ? 'uuid-a' : 'uuid-b', region: '춘천',
      name: '검증용 가맹점', category: '음식점', address: '검증용 주소',
      latitude: 37.88, longitude: 127.73, phone: '033-000-0000',
      cuisine: '한식', naver_classification: '검증용',
      weekday_open: '09:00', weekday_close: '20:00',
      in_under_10000: 'Y', min_meal_price_won: '9000',
      confirmed_meals: [{ name: '비빔밥', price: 9000 }],
    }
    return new Response(JSON.stringify({ total: 2, merchants: [row] }), { status: 200 })
  }
  try {
    const rows = await loadRegionMerchants('춘천')
    assert.deepEqual(offsets, ['0', '1'])
    assert.deepEqual(rows.map(r => r.merchantId), ['uuid-a', 'uuid-b'])
    assert.equal(rows[0].under10000, 'Y')
    assert.equal(rows[0].minMealPriceWon, 9000)
    assert.equal(rows[0].businessHours?.weekday, '09:00 ~ 20:00')
    assert.equal(rows[0].phone, '033-000-0000')
    assert.deepEqual(rows[0].confirmedMeals, [{ name: '비빔밥', price: 9000 }])
  } finally { globalThis.fetch = originalFetch }
})
