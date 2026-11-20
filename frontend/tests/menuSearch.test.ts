import assert from 'node:assert/strict'
import test from 'node:test'
import { matchedMenuNames, matchesSearch, menuMatchLabel, normalizeSearchText } from '../src/menuSearch.ts'
import { loadRegionMerchants } from '../src/merchantApi.ts'

const store = (name: string, menuNames?: string[], extra: Partial<{ address: string; rawCategory: string; detailCategory: string }> = {}) => ({
  name,
  address: extra.address ?? '강원특별자치도 춘천시 중앙로 33',
  rawCategory: extra.rawCategory ?? '음식점',
  detailCategory: extra.detailCategory ?? '한식',
  ...(menuNames ? { menuNames } : {}),
})

test('정규화: 대소문자와 띄어쓰기를 무시한다', () => {
  assert.equal(normalizeSearchText('  GS25 강릉 에이스 '), 'gs25강릉에이스')
})

test('검색어가 비어 있으면 모든 가게가 맞는다', () => {
  assert.equal(matchesSearch(store('아무 가게'), ''), true)
  assert.equal(matchesSearch(store('아무 가게'), '   '), true)
})

test('② 가게 이름: 띄어쓰기가 달라도 찾는다', () => {
  assert.equal(matchesSearch(store('김밥천국 퇴계점'), '김밥 천국'), true)
  assert.equal(matchesSearch(store('김밥천국 퇴계점'), '김밥천국퇴계'), true)
  assert.equal(matchesSearch(store('김밥천국 퇴계점'), '라면'), false)
})

test('① 승인된 메뉴 이름으로 찾고, 메뉴가 없는 가게는 메뉴로는 안 잡힌다', () => {
  const ramen = store('윤실식당', ['라면', '김치찌개'])
  assert.equal(matchesSearch(ramen, '라면'), true)
  assert.equal(matchesSearch(store('메뉴 모름 식당'), '라면'), false)
  // 메뉴 이름의 띄어쓰기도 무시한다.
  assert.equal(matchesSearch(store('연어집', ['연어 덮밥']), '연어덮밥'), true)
})

test('여러 단어는 모두 들어 있어야 하고, 이름·메뉴·주소 어디에 있어도 된다', () => {
  const s = store('윤실식당', ['라면', '김치찌개'], { address: '강원특별자치도 춘천시 퇴계로 10' })
  assert.equal(matchesSearch(s, '퇴계 라면'), true) // 주소 + 메뉴
  assert.equal(matchesSearch(s, '윤실 김치찌개'), true) // 이름 + 메뉴
  assert.equal(matchesSearch(s, '라면 짜장면'), false) // 짜장면이 없다
})

test('업종(detailCategory)으로도 지금처럼 찾는다', () => {
  assert.equal(matchesSearch(store('어느 중국집', undefined, { detailCategory: '중식당' }), '중식'), true)
})

test('걸린 메뉴 이름과 카드 문구', () => {
  const s = store('윤실식당', ['라면', '치즈라면', '김치찌개'])
  assert.deepEqual(matchedMenuNames(s, '라면'), ['라면', '치즈라면'])
  assert.deepEqual(matchedMenuNames(s, ''), [])
  assert.deepEqual(matchedMenuNames(store('메뉴 모름'), '라면'), [])
  assert.equal(menuMatchLabel(['라면']), '메뉴: 라면')
  assert.equal(menuMatchLabel(['라면', '치즈라면', '떡라면']), '메뉴: 라면 외 2개')
  assert.equal(menuMatchLabel([]), null)
})

test('서버의 menu_names 를 메뉴 이름 목록으로 받고, 이상한 값은 버린다', async () => {
  const row = (merchant_id: string, name: string, menu_names: unknown) => ({
    merchant_id, region: '춘천시', name, address: '주소', latitude: 37.88, longitude: 127.72,
    category: '음식점', source_category_code: null, phone: null, menu_names,
  })
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({
      total: 3,
      merchants: [
        row('1', '윤실식당', ['라면', '', null, 7, '김치찌개']),
        row('2', '메뉴 없음', null),
        row('3', '형식 이상', 'not-an-array'),
      ],
    }))
  try {
    const [a, b, c] = await loadRegionMerchants('춘천시')
    assert.deepEqual(a.menuNames, ['라면', '김치찌개'])
    assert.equal(b.menuNames, undefined)
    assert.equal(c.menuNames, undefined)
  } finally {
    globalThis.fetch = original
  }
})
