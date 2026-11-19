import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceWon, validateMenuItems } from './menuPrice.js';

test('숫자 표기를 정수로 변환한다', () => {
  assert.equal(parsePriceWon('8000원'), 8000);
  assert.equal(parsePriceWon('10,000'), 10000);
  assert.equal(parsePriceWon('₩12,000'), 12000);
  assert.equal(parsePriceWon('9000 원'), 9000);
  assert.equal(parsePriceWon('12000won'), 12000);
});

test('만·천 단위 표기를 변환한다', () => {
  assert.equal(parsePriceWon('1만원'), 10000);
  assert.equal(parsePriceWon('만원'), 10000);
  assert.equal(parsePriceWon('1만 2천원'), 12000);
  assert.equal(parsePriceWon('1만2천'), 12000);
  assert.equal(parsePriceWon('1.5만'), 15000);
  assert.equal(parsePriceWon('8천원'), 8000);
  assert.equal(parsePriceWon('천원'), 1000);
});

test('한글 숫자 표기를 변환한다', () => {
  assert.equal(parsePriceWon('삼천원'), 3000);
  assert.equal(parsePriceWon('일만이천원'), 12000);
  assert.equal(parsePriceWon('만이천원'), 12000);
  assert.equal(parsePriceWon('칠천오백원'), 7500);
});

test('모호하거나 해석할 수 없으면 null', () => {
  assert.equal(parsePriceWon('9'), null); // 천 원 단위 표기일 수 있음
  assert.equal(parsePriceWon('8~10천원'), null);
  assert.equal(parsePriceWon('8000/10000'), null);
  assert.equal(parsePriceWon('시가'), null);
  assert.equal(parsePriceWon(''), null);
  assert.equal(parsePriceWon(null), null);
});

test('검증: 정상 항목은 ok, 불일치·불확실은 uncertain', () => {
  const { items, rejected } = validateMenuItems([
    { name: '김치찌개', price_text: '9,000', price_won: 9000, category: 'meal', uncertain: false },
    { name: '된장찌개', price_text: '1만원', price_won: 1000, category: 'meal', uncertain: false },
    { name: '제육볶음', price_text: '9000', price_won: 9000, category: 'meal', uncertain: true },
  ]);

  assert.deepEqual(rejected, []);
  assert.deepEqual(
    items.map(i => [i.name, i.price_won, i.status]),
    [
      ['김치찌개', 9000, 'ok'],
      ['된장찌개', 10000, 'uncertain'], // 서버 파싱값(10000) 우선, 모델과 달라 uncertain
      ['제육볶음', 9000, 'uncertain'],
    ]
  );
});

test('검증: 범위 밖·가격 없음·이름 없음은 반려', () => {
  const { items, rejected } = validateMenuItems([
    { name: '공기밥', price_text: '300원', price_won: 300 },
    { name: '한우 세트', price_text: '15만원', price_won: 150000 },
    { name: '시가 메뉴', price_text: '시가', price_won: null },
    { name: '', price_text: '8000', price_won: 8000 },
    { name: '비빔밥', price_text: '8000', price_won: 8000, category: 'meal' },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].name, '비빔밥');
  assert.equal(rejected.length, 4);
});

test('검증: 메뉴 분류를 그대로 전달하고, 없거나 이상하면 uncertain', () => {
  const { items } = validateMenuItems([
    { name: '공기밥', price_text: '1000', price_won: 1000, category: 'side', uncertain: false },
    { name: '소주', price_text: '4000', price_won: 4000, category: 'alcohol', uncertain: false },
    { name: '비빔밥', price_text: '8000', price_won: 8000, category: 'meal', uncertain: false },
    { name: '냉면', price_text: '9000', price_won: 9000, uncertain: false },
    { name: '우동', price_text: '7000', price_won: 7000, category: '식사', uncertain: false },
  ]);

  assert.deepEqual(
    items.map(i => [i.name, i.category, i.status]),
    [
      ['공기밥', 'side', 'ok'],
      ['소주', 'alcohol', 'ok'],
      ['비빔밥', 'meal', 'ok'],
      ['냉면', 'unknown', 'uncertain'],
      ['우동', 'unknown', 'uncertain'],
    ]
  );
});

test('검증: 배열이 아니면 빈 결과', () => {
  assert.deepEqual(validateMenuItems(undefined), { items: [], rejected: [] });
});
