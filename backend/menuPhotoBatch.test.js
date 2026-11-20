import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MENU_PHOTOS, extractMenusFromPhotos, mapWithLimit, mergeOcrResults } from './menuPhotoBatch.js';

const item = (name, price_won, status = 'ok', category = 'meal') => ({ name, price_won, price_text: String(price_won), category, status });

test('한 번에 올릴 수 있는 사진은 최대 5장이다', () => {
  assert.equal(MAX_MENU_PHOTOS, 5);
});

test('합치기: 각 메뉴에 몇 번째 사진에서 읽었는지 붙이고, 걸러진 항목도 사진 번호와 함께 모은다', () => {
  const merged = mergeOcrResults([
    { model: 'm1', items: [item('김치찌개', 9000)], rejected: [{ name: '?', price_text: '', reason: '가격 없음' }] },
    { model: 'm1', items: [item('라면', 4000)], rejected: [] },
  ]);
  assert.deepEqual(merged.items.map(i => [i.name, i.photo]), [['김치찌개', 1], ['라면', 2]]);
  assert.deepEqual(merged.rejected, [{ name: '?', price_text: '', reason: '가격 없음', photo: 1 }]);
  assert.equal(merged.model, 'm1');
});

test('합치기: 같은 이름·같은 가격이 여러 사진에 나오면 하나만 남긴다(띄어쓰기 무시)', () => {
  const merged = mergeOcrResults([
    { items: [item('된장 찌개', 8000)] },
    { items: [item('된장찌개', 8000), item('공기밥', 1000, 'ok', 'side')] },
  ]);
  assert.deepEqual(merged.items.map(i => `${i.name}:${i.photo}:${i.status}`), ['된장 찌개:1:ok', '공기밥:2:ok']);
});

test('합치기: 같은 이름인데 가격이 다르면 둘 다 남기고 확인 필요로 표시한다', () => {
  const merged = mergeOcrResults([
    { items: [item('삼겹살', 15000)] },
    { items: [item('삼겹살', 16000)] },
  ]);
  assert.deepEqual(merged.items.map(i => `${i.price_won}:${i.status}`), ['15000:uncertain', '16000:uncertain']);
});

test('합치기: 여러 모델이 쓰였으면(예비 모델 전환) 모두 적는다', () => {
  assert.equal(mergeOcrResults([{ model: 'a', items: [] }, { model: 'b', items: [] }, { model: 'a', items: [] }]).model, 'a, b');
  assert.equal(mergeOcrResults([{ items: [] }]).model, null);
});

test('동시 처리: 한 번에 limit 장까지만 보내고, 결과는 올린 순서를 지킨다', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithLimit([30, 5, 20, 1, 10], 2, async (ms, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, ms));
    running -= 1;
    return index;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});

test('사진 여러 장 OCR: 한 장씩 따로 보내고 합친다', async () => {
  const seen = [];
  const extract = async (buffer, mimeType) => {
    seen.push(`${buffer.toString()}:${mimeType}`);
    return { model: 'm', items: [item(`메뉴${buffer.toString()}`, 5000)], rejected: [] };
  };
  const result = await extractMenusFromPhotos(
    [{ buffer: Buffer.from('1'), mimeType: 'image/png' }, { buffer: Buffer.from('2'), mimeType: 'image/jpeg' }],
    extract
  );
  assert.deepEqual(seen.sort(), ['1:image/png', '2:image/jpeg']);
  assert.deepEqual(result.items.map(i => [i.name, i.photo]), [['메뉴1', 1], ['메뉴2', 2]]);
  assert.equal(result.photoCount, 2);
});

test('사진 여러 장 OCR: 한 장이라도 AI 호출이 실패하면 전체를 실패로 돌려준다', async () => {
  const extract = async buffer => {
    if (buffer.toString() === '2') throw Object.assign(new Error('AI 혼잡'), { status: 503 });
    return { model: 'm', items: [item('메뉴', 5000)], rejected: [] };
  };
  await assert.rejects(
    extractMenusFromPhotos([{ buffer: Buffer.from('1') }, { buffer: Buffer.from('2') }], extract),
    /AI 혼잡/
  );
});
