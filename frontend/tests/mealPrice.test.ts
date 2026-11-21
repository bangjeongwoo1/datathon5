import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfirmedMeals, mealsForDetail, mealsWithinBudget } from '../src/mealPrice.ts'
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

const menu = (name: string, price: number) => ({ name, price })
const menus = [menu('막국수(보통)', 9000), menu('만두국', 10000), menu('막국수(곱배기)', 11000), menu('닭갈비', 16000)]

test('가게 상세: 가격 필터가 꺼져 있으면(null) 승인된 메뉴를 모두 보여 주고 숨긴 것은 없다', () => {
  const { shown, hiddenCount } = mealsForDetail(menus, null)
  assert.deepEqual(shown.map(m => m.name), ['막국수(보통)', '만두국', '막국수(곱배기)', '닭갈비'])
  assert.equal(hiddenCount, 0)
})

test('가게 상세: "만 원 이하" 필터가 켜지면 10,000원 이하만 보여 주고(10,000원 포함) 넘는 개수를 알려 준다', () => {
  const { shown, hiddenCount } = mealsForDetail(menus, 10000)
  assert.deepEqual(shown.map(m => m.name), ['막국수(보통)', '만두국'])
  assert.equal(hiddenCount, 2)
})

test('가게 상세: 직접 입력한 금액도 같은 규칙이다', () => {
  const { shown, hiddenCount } = mealsForDetail(menus, 9500)
  assert.deepEqual(shown.map(m => m.name), ['막국수(보통)'])
  assert.equal(hiddenCount, 3)
})

test('가게 상세: 필터 금액 이하 메뉴가 하나도 없으면 빈 목록과 숨긴 개수를 돌려준다', () => {
  assert.deepEqual(mealsForDetail(menus, 5000), { shown: [], hiddenCount: 4 })
})

test('가게 상세: 메뉴가 없거나 값이 이상해도 오류 없이 빈 목록이다', () => {
  assert.deepEqual(mealsForDetail(undefined, 10000), { shown: [], hiddenCount: 0 })
  assert.deepEqual(mealsForDetail([], null), { shown: [], hiddenCount: 0 })
  const odd = [menu('오류', -1), menu('0원', 0), menu('정상', 8000)]
  assert.deepEqual(mealsForDetail(odd, 10000), { shown: [menu('정상', 8000)], hiddenCount: 0 })
})
