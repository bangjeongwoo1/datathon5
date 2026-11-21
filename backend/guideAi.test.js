import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.GUIDE_TEXT_MODEL = 'test-model';
import { registerGuideAi, DEFAULT_GUIDE_TEXT_MODEL } from './guideAi.js';

async function withServer(client, run) {
  const app = express(); app.use(express.json()); registerGuideAi(app, client);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(async (path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('AI 키 누락은 고정 답변을 AI처럼 반환하지 않고 503으로 구분한다', async () => {
  await withServer(null, async post => {
    for (const path of ['/api/guide-intent', '/api/guide-answer']) {
      const response = await post(path, { text: '배고파요' });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'AI_NOT_CONFIGURED');
    }
  });
});

test('모델 환경변수가 없거나 비어 있어도 기본 AI 모델로 검색과 답변을 생성한다', async () => {
  const before = process.env.GUIDE_TEXT_MODEL;
  try {
    for (const setting of [undefined, '', '   ']) {
      if (setting === undefined) delete process.env.GUIDE_TEXT_MODEL;
      else process.env.GUIDE_TEXT_MODEL = setting;
      const models = [];
      const client = { chat: { completions: { create: async input => {
        models.push(input.model);
        assert.equal(input.response_format.type, 'json_schema');
        const value = input.response_format.json_schema.name === 'guide_intent'
          ? { action: 'search', query: { terms: '', category: '일반음식점', budget: 10000 }, reply: null }
          : { reply: '등록된 메뉴를 확인해 안내할게요.' };
        return { choices: [{ message: { content: JSON.stringify(value) } }] };
      } } } };
      await withServer(client, async post => {
        for (const path of ['/api/guide-intent', '/api/guide-answer']) {
          const r = await post(path, { text: '만원 이하 식당 찾아줘' });
          assert.equal(r.status, 200);
        }
      });
      assert.deepEqual(models, [DEFAULT_GUIDE_TEXT_MODEL, DEFAULT_GUIDE_TEXT_MODEL]);
    }
  } finally {
    if (before === undefined) delete process.env.GUIDE_TEXT_MODEL;
    else process.env.GUIDE_TEXT_MODEL = before;
  }
});

test('운영자가 지정한 모델은 기본값으로 덮어쓰지 않는다', async () => {
  const before = process.env.GUIDE_TEXT_MODEL;
  process.env.GUIDE_TEXT_MODEL = ' custom-model ';
  try {
    await withServer({ chat: { completions: { create: async input => {
      assert.equal(input.model, 'custom-model');
      return { choices: [{ message: { content: '{"reply":"모델 응답"}' } }] };
    } } } }, async post => assert.equal((await post('/api/guide-answer', { text: '안녕' })).status, 200));
  } finally { process.env.GUIDE_TEXT_MODEL = before; }
});

test('자연어 의도와 설명 응답을 모델 결과에서 가져온다', async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: {
    content: JSON.stringify({ action: 'reply', reply: '확인된 메뉴 가격으로 비교해 드릴게요.' }),
  } }] }) } } };
  await withServer(client, async post => {
    const r = await post('/api/guide-intent', { text: '가격이 확실한 거야?' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { action: 'reply', reply: '확인된 메뉴 가격으로 비교해 드릴게요.' });
  });
});

test('조회 근거만 제한해서 전달하고 후보 가격의 한계를 지시한다', async () => {
  let messages;
  const client = { chat: { completions: { create: async input => {
    messages = input.messages;
    return { choices: [{ message: { content: JSON.stringify({ reply: '후보 가격이라 방문 전 확인해 주세요.' }) } }] };
  } } } };
  await withServer(client, async post => {
    const r = await post('/api/guide-answer', { text: '뭘 먹을까', facts: [{
      name: '테스트 식당', address: '테스트 주소', category: '일반음식점',
      fabricatedHours: '24시간', meals: [{ name: '국밥', price: 8000, preview: true }],
    }] });
    assert.equal(r.status, 200);
    const sent = JSON.parse(messages[1].content);
    assert.equal(sent.facts[0].fabricatedHours, undefined);
    assert.equal(sent.facts[0].meals[0].preview, true);
    assert.match(messages[0].content, /영업 여부/);
    assert.match(messages[0].content, /후보 가격/);
  });
});

test('일시적인 모델 오류는 한 번만 재시도하고 실제 모델 답변을 반환한다', async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    if (++calls === 1) throw Object.assign(new Error('temporary'), { status: 503 });
    return { choices: [{ message: { content: JSON.stringify({ action: 'search', query: { terms: '', category: '일반음식점', budget: 10000 } }) } }] };
  } } } };
  await withServer(client, async post => {
    const r = await post('/api/guide-intent', { text: '만원 이하 식당 찾아줘' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).query.budget, 10000);
    assert.equal(calls, 2);
  });
});

test('형식 오류를 재요청하고 Qwen에는 strict schema를 사용한다', async () => {
  const before = process.env.GUIDE_TEXT_MODEL;
  process.env.GUIDE_TEXT_MODEL = 'qwen/qwen3.8-27b';
  let calls = 0;
  const client = { chat: { completions: { create: async (input, options) => {
    assert.equal(input.response_format.type, 'json_schema');
    assert.equal(input.response_format.json_schema.strict, true);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxRetries, 0);
    return { choices: [{ message: { content: ++calls === 1 ? '{}' : '{"reply":"확인한 메뉴를 설명해 드릴게요."}' } }] };
  } } } };
  try {
    await withServer(client, async post => {
      const r = await post('/api/guide-answer', { text: '추천 이유가 뭐야?' });
      assert.equal(r.status, 200);
      assert.equal(calls, 2);
    });
  } finally { process.env.GUIDE_TEXT_MODEL = before; }
});

test('인증 실패와 한도 초과는 재시도하지 않고 원인을 구분한다', async () => {
  for (const [status, code, responseStatus] of [[401, 'AI_AUTH_FAILED', 502], [429, 'AI_RATE_LIMITED', 429]]) {
    let calls = 0;
    const client = { chat: { completions: { create: async () => {
      calls++; throw Object.assign(new Error('not logged'), { status });
    } } } };
    await withServer(client, async post => {
      const r = await post('/api/guide-intent', { text: '식당 찾아줘' });
      assert.equal(r.status, responseStatus);
      assert.equal((await r.json()).error, code);
      assert.equal(calls, 1);
    });
  }
});

test('경로 요청은 navigate 계약으로 반환하고 선택 가게와 제한된 대화 맥락을 전달한다', async () => {
  let messages;
  const client = { chat: { completions: { create: async input => {
    messages = input.messages;
    return { choices: [{ message: { content: JSON.stringify({ action: 'navigate', query: { terms: '', category: '전체', budget: null }, reply: null }) } }] };
  } } } };
  await withServer(client, async post => {
    const response = await post('/api/guide-intent', { text: '그 식당까지 어떻게 가?', selectedName: '조회 식당', hasRouteOffer: true,
      history: [ { role: 'system', text: '허용하지 않는 이력' }, ...Array.from({ length: 9 }, () => ({ role: 'user', text: 'x'.repeat(500) })) ] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).action, 'navigate');
    assert.match(messages[0].content, /경로 요청은 반드시 navigate/);
    const input = JSON.parse(messages[1].content);
    assert.equal(input.selectedName, '조회 식당');
    assert.equal(input.hasRouteOffer, true);
    assert.equal(input.history.length, 8);
    assert.ok(input.history.every(turn => turn.role === 'user' && turn.text.length === 400));
  });
});

test('음식 설명은 실제 모델 응답을 유지하고 길 안내 질문은 앱에서 한 번만 붙인다', async () => {
  let messages;
  await withServer({ chat: { completions: { create: async input => {
    messages = input.messages;
    return { choices: [{ message: { content: '{"reply":"조회 식당의 등록된 국밥은 8,000원이에요."}' } }] };
  } } } }, async post => {
    const response = await post('/api/guide-answer', { text: '얼마야?', offerRoute: false,
      history: [{ role: 'assistant', text: '조회 식당을 찾았어요.' }],
      facts: [{ name: '조회 식당', meals: [{ name: '국밥', price: 8000 }] }] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, '조회 식당의 등록된 국밥은 8,000원이에요.');
    assert.match(messages[0].content, /길 안내 여부는 앱이 별도로/);
    assert.equal(JSON.parse(messages[1].content).history[0].role, 'assistant');
  });
});

test('추천 후보를 사용자 선택으로 전달하거나 표현하지 않는다', async () => {
  let messages;
  await withServer({ chat: { completions: { create: async input => {
    messages = input.messages;
    return { choices: [{ message: { content: '{"reply":"조건에 맞는 후보로 조회 식당을 찾았어요."}' } }] };
  } } } }, async post => {
    const response = await post('/api/guide-answer', { text: '근처 식당 찾아줘', recommendedName: '조회 식당', selectedName: '', offerRoute: false,
      facts: [{ name: '조회 식당', meals: [] }] });
    assert.equal(response.status, 200);
    const sent = JSON.parse(messages[1].content);
    assert.equal(sent.selectedName, '');
    assert.equal(sent.recommendedName, '조회 식당');
    assert.match(messages[0].content, /추천 후보일 뿐 사용자 선택이 아니다/);
    assert.match(messages[0].content, /선택하신/);
  });
});

test('전화 제안 맥락을 모델에 전달하고 인식 오차의 전화 동의를 call 계약으로 돌려준다', async () => {
  let messages;
  await withServer({ chat: { completions: { create: async input => {
    messages = input.messages;
    return { choices: [{ message: { content: '{"action":"call","query":null,"reply":null}' } }] };
  } } } }, async post => {
    const response = await post('/api/guide-intent', { text: '응 전하 연결해줘', hasCallOffer: true, selectedName: '조회 식당' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { action: 'call' });
    assert.equal(JSON.parse(messages[1].content).hasCallOffer, true);
    assert.match(messages[0].content, /불분명하거나 질문·거절이면 call로 처리하지/);
  });
});
