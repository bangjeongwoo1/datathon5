// 메뉴판 가격 표기(10,000원 / 1만원 / 만원 / 1만 2천원 / 삼천원 ...)를
// 정수 원 단위로 바꾸고, OCR 결과 항목을 검증하는 순수 함수 모음.

export const MIN_PRICE_WON = 500;
export const MAX_PRICE_WON = 100000;
const MAX_NAME_LENGTH = 60;

// meal: 한 끼 식사, side: 곁들임(공기밥·사리 등), drink: 음료, alcohol: 주류
// "만원 이하 메뉴" 필터는 meal만 기준으로 한다.
export const MENU_CATEGORIES = ['meal', 'side', 'drink', 'alcohol'];

const HANGUL_DIGITS = {
  일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9,
};
const SMALL_UNITS = { 십: 10, 백: 100, 천: 1000 };

/**
 * 가격 문자열을 정수 원으로 변환한다. 해석할 수 없거나 모호하면 null.
 * - "8000원", "10,000", "₩12,000"          → 8000, 10000, 12000
 * - "1만원", "만원", "1만 2천원", "1.5만"   → 10000, 10000, 12000, 15000
 * - "삼천원", "일만이천원"                  → 3000, 12000
 * - 단위 없는 100 미만 숫자("9", "12")는 천 원 단위 표기일 수 있어 모호하므로 null
 */
export function parsePriceWon(input) {
  if (typeof input !== 'string') return null;

  const text = input
    .normalize('NFKC')
    .replace(/[\s,₩\\]/g, '')
    .replace(/원|won|krw/gi, '');

  if (!text || /[~/\-+]/.test(text)) return null; // 범위·복수 가격은 거부

  let total = 0;
  let section = 0;
  let num = 0;
  let hasNum = false;
  let usedUnit = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < text.length && /[0-9.]/.test(text[j])) j++;
      const run = text.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(run)) return null;
      num = Number(run);
      hasNum = true;
      i = j;
      continue;
    }

    if (ch in HANGUL_DIGITS) {
      num = HANGUL_DIGITS[ch];
      hasNum = true;
    } else if (ch in SMALL_UNITS) {
      section += (hasNum ? num : 1) * SMALL_UNITS[ch];
      num = 0;
      hasNum = false;
      usedUnit = true;
    } else if (ch === '만') {
      total += ((section + (hasNum ? num : 0)) || 1) * 10000;
      section = 0;
      num = 0;
      hasNum = false;
      usedUnit = true;
    } else {
      return null;
    }
    i++;
  }

  const value = Math.round(total + section + (hasNum ? num : 0));

  if (!Number.isFinite(value) || value <= 0) return null;
  if (!usedUnit && value < 100) return null;
  return value;
}

/**
 * Gemini가 돌려준 항목들을 검증한다.
 * 각 항목: { name, price_text, price_won, uncertain }
 *
 * 가격은 서버가 price_text에서 직접 파싱한 값을 우선 사용한다.
 * - 서버 파싱값과 모델 변환값이 다르면 uncertain
 * - 한쪽만 값이 있으면 uncertain
 * - 범위(500~100,000원)를 벗어나거나 가격이 없으면 rejected
 */
export function validateMenuItems(rawItems) {
  const items = [];
  const rejected = [];

  if (!Array.isArray(rawItems)) return { items, rejected };

  for (const raw of rawItems) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    const priceText =
      typeof raw?.price_text === 'string' ? raw.price_text.trim() : '';
    const modelPrice = Number.isFinite(raw?.price_won)
      ? Math.round(raw.price_won)
      : null;

    if (!name || name.length > MAX_NAME_LENGTH) {
      rejected.push({ name, price_text: priceText, reason: '메뉴 이름 오류' });
      continue;
    }

    const parsed = parsePriceWon(priceText);
    const price = parsed ?? modelPrice;

    if (price === null) {
      rejected.push({ name, price_text: priceText, reason: '가격 해석 불가' });
      continue;
    }

    if (price < MIN_PRICE_WON || price > MAX_PRICE_WON) {
      rejected.push({
        name,
        price_text: priceText,
        reason: `가격 범위 밖(${price}원)`,
      });
      continue;
    }

    const disagree =
      parsed !== null && modelPrice !== null && parsed !== modelPrice;
    const onlyOneSource = parsed === null || modelPrice === null;

    // 분류가 없거나 이상하면 'unknown'으로 두고 사람이 확인하게 한다.
    const category = MENU_CATEGORIES.includes(raw?.category)
      ? raw.category
      : 'unknown';

    items.push({
      name,
      price_won: price,
      price_text: priceText,
      category,
      status:
        raw?.uncertain === true ||
        disagree ||
        onlyOneSource ||
        category === 'unknown'
          ? 'uncertain'
          : 'ok',
    });
  }

  return { items, rejected };
}
