import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceWon, parseThousandNotation, validateMenuItems } from './menuPrice.js';

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

test('쉼표 뒤가 1~2자리면 천 단위 구분이 아니라 소수점으로 본다', () => {
  assert.equal(parsePriceWon('40,0'), null); // 예전에는 쉼표를 지워 400원으로 잘못 읽었다
  assert.equal(parsePriceWon('29,0'), null);
  assert.equal(parsePriceWon('1,5'), null);
  assert.equal(parsePriceWon('99.8'), null); // 반올림하면 100이 되지만 여전히 모호하다
  // 천 단위 구분(뒤에 3자리)은 그대로 읽는다
  assert.equal(parsePriceWon('40,000'), 40000);
  assert.equal(parsePriceWon('1,500원'), 1500);
});

test('천 원 단위 소수 표기를 원으로 바꾼 후보값', () => {
  assert.equal(parseThousandNotation('3.0'), 3000);
  assert.equal(parseThousandNotation('4.5'), 4500);
  assert.equal(parseThousandNotation('15.9'), 15900);
  assert.equal(parseThousandNotation('15.900'), 15900);
  assert.equal(parseThousandNotation('3.000'), 3000);
  assert.equal(parseThousandNotation('0.5'), 500);
  assert.equal(parseThousandNotation('99.8'), 99800);
  assert.equal(parseThousandNotation('40,0'), 40000);
  assert.equal(parseThousandNotation('3.0원'), 3000);
  assert.equal(parseThousandNotation('3.'), 3000); // 끝에 점만 붙은 표기
  assert.equal(parseThousandNotation('15.'), 15000);
});

test('천 원 단위 소수 표기: 해당하지 않거나 범위를 벗어나면 null', () => {
  assert.equal(parseThousandNotation('3'), null); // 소수가 아님
  assert.equal(parseThousandNotation('9000'), null);
  assert.equal(parseThousandNotation('1만원'), null);
  assert.equal(parseThousandNotation('시가'), null);
  assert.equal(parseThousandNotation('3.0, 2.0'), null); // 가격이 둘
  assert.equal(parseThousandNotation('120.5'), null); // 120,500원: 상한 초과
  assert.equal(parseThousandNotation('0.1'), null); // 100원: 하한 미만
  assert.equal(parseThousandNotation(null), null);
});

test('검증: 소수 표기를 모델이 같은 값으로 읽었으면 ok', () => {
  const { items, rejected } = validateMenuItems([
    { name: '와플', price_text: '3.0', price_won: 3000, category: 'side', uncertain: false },
    { name: '연어', price_text: '15.900', price_won: 15900, category: 'meal', uncertain: false },
    { name: '돈까스', price_text: '10.0', price_won: 10000, category: 'meal', uncertain: false },
  ]);

  assert.deepEqual(rejected, []);
  assert.deepEqual(
    items.map(i => [i.name, i.price_won, i.status]),
    [['와플', 3000, 'ok'], ['연어', 15900, 'ok'], ['돈까스', 10000, 'ok']]
  );
});

test('검증: 소수 표기를 모델이 다르게 읽으면 사진 속 표기에서 계산한 값을 쓰고 uncertain', () => {
  const { items, rejected } = validateMenuItems([
    // 모델이 99.8을 100원으로 읽음(범위 밖) → 예전에는 반려됐다
    { name: '꽃문어 코다리찜 (대)', price_text: '99.8', price_won: 100, category: 'meal', uncertain: false },
    // 모델이 40,0을 400원으로 읽음
    { name: 'A 양념갈비', price_text: '40,0', price_won: 400, category: 'meal', uncertain: false },
    // 둘 다 범위 안이지만 서로 다름
    { name: '불고기', price_text: '9.9', price_won: 10000, category: 'meal', uncertain: false },
    // 모델이 가격을 못 읽음
    { name: '김', price_text: '0.5', price_won: null, category: 'side', uncertain: false },
  ]);

  assert.deepEqual(rejected, []);
  assert.deepEqual(
    items.map(i => [i.name, i.price_won, i.status]),
    [
      ['꽃문어 코다리찜 (대)', 99800, 'uncertain'],
      ['A 양념갈비', 40000, 'uncertain'],
      ['불고기', 9900, 'uncertain'],
      ['김', 500, 'uncertain'],
    ]
  );
});

test('검증: 소수 표기 후보가 범위를 벗어나면 예전처럼 모델 값에 의존해 uncertain', () => {
  const { items, rejected } = validateMenuItems([
    { name: '특대', price_text: '120.5', price_won: 12, category: 'meal', uncertain: false },
    { name: '세트', price_text: '3.0, 2.0', price_won: 3000, category: 'meal', uncertain: false },
  ]);

  // 120.5 → 후보 없음, 모델 12원 → 범위 밖이라 반려
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /가격 범위 밖/);
  // 가격이 둘인 표기는 서버가 읽지 못하므로 모델 값만 쓰고 uncertain
  assert.deepEqual(items.map(i => [i.name, i.price_won, i.status]), [['세트', 3000, 'uncertain']]);
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
