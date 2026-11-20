import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.GUIDE_TEXT_MODEL = 'test-model';
import { registerGuideAi } from './guideAi.js';

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
