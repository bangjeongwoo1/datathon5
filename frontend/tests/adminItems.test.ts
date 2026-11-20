import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildApproval,
  emptyDraft,
  parsePriceInput,
  previewUnder10000,
  toDrafts,
  validateDraft,
} from '../src/adminItems.ts'
import { AdminApiError, approveSubmission, fetchSubmissions } from '../src/adminApi.ts'

const ocrItems = [
  { name: '김치찌개', price_won: 9000, price_text: '9,000', category: 'meal', status: 'ok' },
  { name: '공기밥', price_won: 1000, price_text: '1,000', category: 'side', status: 'uncertain' },
] as const

test('OCR 결과를 고칠 수 있는 목록으로 바꾸고 확신 없는 항목을 표시한다', () => {
  const drafts = toDrafts([...ocrItems])
  assert.deepEqual(
    drafts.map(({ name, price, category, uncertain }) => ({ name, price, category, uncertain })),
    [
      { name: '김치찌개', price: '9000', category: 'meal', uncertain: false },
      { name: '공기밥', price: '1000', category: 'side', uncertain: true },
    ],
  )
  assert.notEqual(drafts[0].key, drafts[1].key)
})

test('가격 입력: 쉼표·원·공백은 무시하고 숫자가 아니면 null', () => {
  assert.equal(parsePriceInput('9,000'), 9000)
  assert.equal(parsePriceInput(' 9000원 '), 9000)
  assert.equal(parsePriceInput('9.5'), null)
  assert.equal(parsePriceInput('abc'), null)
  assert.equal(parsePriceInput(''), null)
  assert.equal(parsePriceInput('-5000'), null)
})

test('한 줄 검사: 이름·가격 범위·분류', () => {
  const ok = { ...emptyDraft(), name: '밥', price: '5000' }
  assert.equal(validateDraft(ok), null)
  assert.match(validateDraft({ ...ok, name: ' ' }) ?? '', /이름/)
  assert.match(validateDraft({ ...ok, price: '100' }) ?? '', /500/)
  assert.match(validateDraft({ ...ok, price: '999999' }) ?? '', /100,000/)
  assert.match(validateDraft({ ...ok, price: 'x' }) ?? '', /숫자/)
  assert.match(validateDraft({ ...ok, category: 'unknown' }) ?? '', /분류/)
})

test('승인 준비: 문제가 없으면 서버로 보낼 형태, 있으면 몇 번째인지 알려 준다', () => {
  const a = { ...emptyDraft(), name: ' 김치찌개 ', price: '9,000', category: 'meal' as const }
  const b = { ...emptyDraft(), name: '맥주', price: '4500', category: 'alcohol' as const }
  assert.deepEqual(buildApproval([a, b]), {
    ok: true,
    items: [
      { name: '김치찌개', price_won: 9000, category: 'meal' },
      { name: '맥주', price_won: 4500, category: 'alcohol' },
    ],
  })

  const bad = buildApproval([a, { ...b, category: 'unknown' }])
  assert.equal(bad.ok, false)
  assert.match(bad.ok ? '' : bad.error, /^2번째 메뉴/)
  assert.equal(buildApproval([]).ok, false)
})

test('만원 이하 미리보기: 식사 기준, 1만 원은 포함, 식사가 없으면 모름', () => {
  const item = (price_won: number, category: 'meal' | 'side') => ({ name: 'x', price_won, category })
  assert.equal(previewUnder10000([item(10000, 'meal')]), 'Y')
  assert.equal(previewUnder10000([item(10500, 'meal'), item(3000, 'side')]), 'N')
  assert.equal(previewUnder10000([item(3000, 'side')]), null)
  assert.equal(previewUnder10000([]), null)
})

test('API: 토큰을 헤더로 보내고, 서버 오류 문구와 상태를 그대로 전달한다', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return new Response(JSON.stringify({ items: [] }), { status: 200 })
  }) as unknown as typeof fetch
  assert.deepEqual(await fetchSubmissions('pending', { token: 'tok', fetchImpl }), [])
  assert.match(seen!.url, /\/api\/admin\/submissions\?status=pending$/)
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer tok')

  const conflict = (async () =>
    new Response(JSON.stringify({ error: '이미 처리된 제보입니다.' }), { status: 409 })) as unknown as typeof fetch
  await assert.rejects(
    approveSubmission(1, { items: [] }, { token: 't', fetchImpl: conflict }),
    (error: unknown) =>
      error instanceof AdminApiError && error.status === 409 && error.message === '이미 처리된 제보입니다.',
  )

  const down = (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
  await assert.rejects(
    fetchSubmissions('pending', { token: 't', fetchImpl: down }),
    (error: unknown) => error instanceof AdminApiError && error.status === 0,
  )
})

test('승인 미리보기(추가): 같은 이름은 갱신, 새 메뉴는 추가, 나머지는 유지', async () => {
  const { previewApproval } = await import('../src/adminItems.ts')
  const current = [
    { name: '바지락 칼국수', price_won: 9000, category: 'meal' },
    { name: '왕만두', price_won: 3000, category: 'side' },
  ]
  const approved = [
    { name: '바지락칼국수', price_won: 9500, category: 'meal' as const },
    { name: '들깨수제비', price_won: 9000, category: 'meal' as const },
  ]
  const r = previewApproval(current, approved, 'merge')
  assert.equal(r.added, 1)
  assert.equal(r.updated, 1)
  assert.equal(r.kept, 1)
  assert.equal(r.removed, 0)
  assert.deepEqual(r.items.map(i => `${i.name}:${i.price_won}`).sort(), ['들깨수제비:9000', '바지락칼국수:9500', '왕만두:3000'])
})

test('승인 미리보기(교체): 기존 메뉴는 모두 지워지고 이번 목록만 남는다', async () => {
  const { previewApproval } = await import('../src/adminItems.ts')
  const current = [
    { name: '바지락 칼국수', price_won: 9000, category: 'meal' },
    { name: '왕만두', price_won: 3000, category: 'side' },
  ]
  const r = previewApproval(current, [{ name: '수제비', price_won: 8000, category: 'meal' }], 'replace')
  assert.deepEqual(r, { items: [{ name: '수제비', price_won: 8000, category: 'meal' }], added: 1, updated: 0, kept: 0, removed: 2 })
})

test('승인 미리보기: 목록 안의 같은 이름은 마지막 것만 쓴다(서버와 같은 규칙)', async () => {
  const { previewApproval } = await import('../src/adminItems.ts')
  const r = previewApproval([], [
    { name: '라면', price_won: 4000, category: 'meal' },
    { name: '라 면', price_won: 4500, category: 'meal' },
  ], 'merge')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].price_won, 4500)
  assert.equal(r.added, 1)
})

test('API: 승인할 때 승인 방식(mode)을 함께 보낸다', async () => {
  let body: unknown = null
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ status: 'approved', merchant_id: '1', mode: 'merge', menu_count: 1, added: 1, updated: 0, removed: 0 }))
  }) as unknown as typeof fetch
  await approveSubmission(3, { items: [{ name: '라면', price_won: 4000, category: 'meal' }], mode: 'merge' }, { token: 't', fetchImpl })
  assert.deepEqual(body, { items: [{ name: '라면', price_won: 4000, category: 'meal' }], mode: 'merge' })
})
