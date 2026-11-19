import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMenuFromImage, MenuOcrError } from './menuOcr.js';

process.env.GEMINI_RETRY_DELAY_MS = '0'; // 테스트에서는 재시도 대기 없음
delete process.env.GEMINI_FALLBACK_MODEL;

function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function geminiReply(obj) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    }),
    { status: 200 }
  );
}

test('Gemini 응답을 검증된 메뉴 목록으로 바꾼다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  let request;
  const restore = mockFetch(async (url, init) => {
    request = { url, init };
    return geminiReply({
      items: [
        { name: '김치찌개', price_text: '9,000', price_won: 9000, category: 'meal', uncertain: false },
        { name: '계란말이', price_text: '만원', price_won: 10000, category: 'side', uncertain: false },
        { name: '소주', price_text: '시가', price_won: null, category: 'alcohol', uncertain: true },
      ],
    });
  });

  try {
    const result = await extractMenuFromImage(Buffer.from('fake'), 'image/jpeg');
    assert.deepEqual(
      result.items.map(i => [i.name, i.price_won, i.status]),
      [['김치찌개', 9000, 'ok'], ['계란말이', 10000, 'ok']]
    );
    assert.equal(result.rejected.length, 1);

    // 키는 헤더로만 전달하고 URL에는 넣지 않는다
    assert.equal(request.init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!request.url.includes('test-key'));
    const body = JSON.parse(request.init.body);
    assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
  } finally {
    restore();
  }
});

const OK_BODY = {
  items: [{ name: '김치찌개', price_text: '9000', price_won: 9000, category: 'meal', uncertain: false }],
};

test('503이면 같은 모델로 재시도해 성공한다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'model-a';
  let calls = 0;
  const restore = mockFetch(async () => {
    calls += 1;
    return calls < 3 ? new Response('busy', { status: 503 }) : geminiReply(OK_BODY);
  });

  try {
    const result = await extractMenuFromImage(Buffer.from('x'), 'image/png');
    assert.equal(calls, 3); // 최초 1회 + 재시도 2회
    assert.equal(result.model, 'model-a');
    assert.equal(result.items.length, 1);
  } finally {
    restore();
    delete process.env.GEMINI_MODEL;
  }
});

test('재시도 후에도 실패하면 예비 모델로 전환한다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'model-a';
  process.env.GEMINI_FALLBACK_MODEL = 'model-b';
  const calledModels = [];
  const restore = mockFetch(async url => {
    const model = String(url).split('/models/')[1].split(':')[0];
    calledModels.push(model);
    return model === 'model-b'
      ? geminiReply(OK_BODY)
      : new Response('busy', { status: 503 });
  });

  try {
    const result = await extractMenuFromImage(Buffer.from('x'), 'image/png');
    assert.deepEqual(calledModels, ['model-a', 'model-a', 'model-a', 'model-b']);
    assert.equal(result.model, 'model-b');
  } finally {
    restore();
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('429는 같은 모델로 재시도하지 않고 예비 모델로 넘어간다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'model-a';
  process.env.GEMINI_FALLBACK_MODEL = 'model-b';
  const calledModels = [];
  const restore = mockFetch(async url => {
    const model = String(url).split('/models/')[1].split(':')[0];
    calledModels.push(model);
    return model === 'model-b'
      ? geminiReply(OK_BODY)
      : new Response('quota', { status: 429 });
  });

  try {
    await extractMenuFromImage(Buffer.from('x'), 'image/png');
    assert.deepEqual(calledModels, ['model-a', 'model-b']);
  } finally {
    restore();
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('타임아웃은 재시도 없이 바로 예비 모델로 넘어간다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'model-a';
  process.env.GEMINI_FALLBACK_MODEL = 'model-b';
  const calledModels = [];
  const restore = mockFetch(async url => {
    const model = String(url).split('/models/')[1].split(':')[0];
    calledModels.push(model);
    if (model === 'model-a') {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return geminiReply(OK_BODY);
  });

  try {
    const result = await extractMenuFromImage(Buffer.from('x'), 'image/png');
    assert.deepEqual(calledModels, ['model-a', 'model-b']);
    assert.equal(result.model, 'model-b');
  } finally {
    restore();
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('키 오류(403)는 재시도·전환 없이 바로 실패한다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_FALLBACK_MODEL = 'model-b';
  let calls = 0;
  const restore = mockFetch(async () => {
    calls += 1;
    return new Response('denied', { status: 403 });
  });

  try {
    await assert.rejects(
      extractMenuFromImage(Buffer.from('x'), 'image/png'),
      e => e instanceof MenuOcrError && e.status === 502
    );
    assert.equal(calls, 1);
  } finally {
    restore();
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('추가 파트(thoughtSignature 등)가 있어도 텍스트만 읽는다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const restore = mockFetch(async () =>
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: '생각 요약', thought: true },
                { text: JSON.stringify(OK_BODY), thoughtSignature: 'abc' },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    )
  );

  try {
    const result = await extractMenuFromImage(Buffer.from('x'), 'image/png');
    assert.equal(result.items.length, 1);
  } finally {
    restore();
  }
});

test('API 오류와 깨진 JSON은 MenuOcrError로 바뀐다', async () => {
  process.env.GEMINI_API_KEY = 'test-key';

  let restore = mockFetch(async () => new Response('quota', { status: 429 }));
  await assert.rejects(
    extractMenuFromImage(Buffer.from('x'), 'image/png'),
    e => e instanceof MenuOcrError && e.status === 429
  );
  restore();

  restore = mockFetch(async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
      { status: 200 }
    )
  );
  await assert.rejects(
    extractMenuFromImage(Buffer.from('x'), 'image/png'),
    e => e instanceof MenuOcrError && e.status === 502
  );
  restore();
});
