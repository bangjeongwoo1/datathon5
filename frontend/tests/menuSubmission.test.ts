import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MenuSubmissionError,
  categoryLabel,
  formatWon,
  submitMenuPhoto,
  validateImageFile,
} from '../src/menuSubmission.ts'

const OK_RESULT = {
  submission_id: 7,
  status: 'pending',
  merchant_id: '12',
  has_uncertain: true,
  items: [{ name: '김치찌개', price_won: 9000, price_text: '9,000', category: 'meal', status: 'ok' }],
  rejected: [],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

const photo = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

test('사진 검사: 허용 형식·용량은 통과하고 나머지는 이유를 돌려준다', () => {
  assert.equal(validateImageFile({ type: 'image/jpeg', size: 1000 }), null)
  assert.equal(validateImageFile({ type: 'image/png', size: 5 * 1024 * 1024 }), null)
  assert.equal(validateImageFile({ type: 'image/webp', size: 1 }), null)

  assert.match(validateImageFile({ type: 'image/gif', size: 1000 }) ?? '', /JPG, PNG, WEBP/)
  assert.match(validateImageFile({ type: 'application/pdf', size: 1000 }) ?? '', /JPG, PNG, WEBP/)
  assert.match(validateImageFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }) ?? '', /5MB/)
  assert.match(validateImageFile({ type: 'image/png', size: 0 }) ?? '', /빈 파일/)
})

test('가격·분류 표시 형식', () => {
  assert.equal(formatWon(9000), '9,000원')
  assert.equal(formatWon(10000), '10,000원')
  assert.equal(categoryLabel('meal'), '식사')
  assert.equal(categoryLabel('side'), '곁들임')
  assert.equal(categoryLabel('drink'), '음료')
  assert.equal(categoryLabel('alcohol'), '주류')
  assert.equal(categoryLabel('unknown'), '미분류')
})

test('제보 전송: 가게 번호를 주소에 넣고 사진을 image 필드로 보낸다', async () => {
  let call: { url: string; init: RequestInit } | undefined
  const result = await submitMenuPhoto({
    merchantId: '12',
    file: photo(),
    fetchImpl: async (url, init) => {
      call = { url: String(url), init: init ?? {} }
      return jsonResponse(OK_RESULT, 201)
    },
  })

  assert.equal(result.submission_id, 7)
  assert.equal(result.status, 'pending')
  assert.equal(call?.url, 'http://localhost:3001/api/merchants/12/menu-submissions')
  assert.equal(call?.init.method, 'POST')
  assert.ok(call?.init.body instanceof FormData)
  assert.ok((call?.init.body as FormData).get('image') instanceof Blob)
  // 로그인하지 않았으면 인증 헤더를 보내지 않는다.
  assert.equal((call?.init.headers as Record<string, string>).Authorization, undefined)
})

test('제보 전송: 가게 번호의 특수문자는 주소에서 안전하게 처리한다', async () => {
  let url = ''
  await submitMenuPhoto({
    merchantId: 'a b/c',
    file: photo(),
    fetchImpl: async u => {
      url = String(u)
      return jsonResponse(OK_RESULT, 201)
    },
  })
  assert.ok(url.endsWith('/api/merchants/a%20b%2Fc/menu-submissions'), url)
})

test('제보 전송: 로그인 토큰이 있으면 Authorization 헤더로 보낸다', async () => {
  let headers: Record<string, string> = {}
  await submitMenuPhoto({
    merchantId: '1',
    file: photo(),
    accessToken: 'token-abc',
    fetchImpl: async (_u, init) => {
      headers = init?.headers as Record<string, string>
      return jsonResponse(OK_RESULT, 201)
    },
  })
  assert.equal(headers.Authorization, 'Bearer token-abc')
})

test('제보 전송: 서버 오류 메시지를 그대로 보여 주고 상태 코드를 담는다', async () => {
  await assert.rejects(
    submitMenuPhoto({
      merchantId: '999',
      file: photo(),
      fetchImpl: async () => jsonResponse({ error: '가맹점을 찾을 수 없습니다.' }, 404),
    }),
    (error: unknown) =>
      error instanceof MenuSubmissionError &&
      error.status === 404 &&
      error.message === '가맹점을 찾을 수 없습니다.',
  )
})

test('제보 전송: 서버 응답이 JSON이 아니면 기본 문구를 쓴다', async () => {
  await assert.rejects(
    submitMenuPhoto({
      merchantId: '1',
      file: photo(),
      fetchImpl: async () => new Response('Bad Gateway', { status: 502 }),
    }),
    (error: unknown) =>
      error instanceof MenuSubmissionError &&
      error.status === 502 &&
      /다시 시도/.test(error.message),
  )
})

test('제보 전송: 네트워크 오류는 친절한 문구로 바꾼다', async () => {
  await assert.rejects(
    submitMenuPhoto({
      merchantId: '1',
      file: photo(),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    }),
    (error: unknown) =>
      error instanceof MenuSubmissionError &&
      error.status === 0 &&
      /연결하지 못했어요/.test(error.message),
  )
})

test('제보 전송: 호출한 쪽이 취소하면 오류 문구로 바꾸지 않고 취소 오류를 그대로 던진다', async () => {
  const controller = new AbortController()
  const pending = submitMenuPhoto({
    merchantId: '1',
    file: photo(),
    signal: controller.signal,
    fetchImpl: (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      }),
  })
  controller.abort()

  await assert.rejects(pending, (error: unknown) => {
    return !(error instanceof MenuSubmissionError) && (error as Error).name === 'AbortError'
  })
})
