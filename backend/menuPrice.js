// 메뉴판 가격 표기(10,000원 / 1만원 / 만원 / 1만 2천원 / 삼천원 ...)를
// 정수 원 단위로 바꾸고, OCR 결과 항목을 검증하는 순수 함수 모음.

export const MIN_PRICE_WON = 500;
export const MAX_PRICE_WON = 100000;
const MAX_NAME_LENGTH = 60;

// meal: 한 끼 식사, side: 사이드(공기밥·사리 등), drink: 음료, alcohol: 주류
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
 * - 단위 없는 100 미만 숫자("9", "12", "3.0")는 천 원 단위 표기일 수 있어 모호하므로 null
 *   (소수 형태는 parseThousandNotation이 따로 후보를 만든다)
 * - 쉼표 뒤에 1~2자리만 오는 "40,0"은 천 단위 구분이 아니라 소수점이므로 null
 */
export function parsePriceWon(input) {
  if (typeof input !== 'string') return null;

  let text = input
    .normalize('NFKC')
    .replace(/[\s₩\\]/g, '')
    .replace(/원|won|krw/gi, '');

  // "10,000"의 쉼표는 천 단위 구분이라 지우지만, "40,0"처럼 뒤에 1~2자리만 오면 소수점이다.
  if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  text = text.replace(/,/g, '');

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

  const raw = total + section + (hasNum ? num : 0);

  if (!Number.isFinite(raw) || raw <= 0) return null;
  // 단위 없는 100 미만 수는 모호하다. 소수("99.8")가 반올림으로 100이 되어 빠져나가지 않도록
  // 반올림하기 전 값으로 판단한다.
  if (!usedUnit && raw < 100) return null;
  return Math.round(raw);
}

/**
 * "천 원 단위 소수 표기"를 원으로 바꾼 후보값. 해당 형태가 아니면 null.
 * 메뉴판에는 3,000원을 "3.0", 15,900원을 "15.9" 또는 "15.900"으로 적는 곳이 많다.
 * - "3.0", "15.9", "15.900", "0.5", "3.000"  → 3000, 15900, 15900, 500, 3000
 * - "40,0", "99.8"                           → 40000, 99800
 *
 * 단위 없는 소수는 원래 모호하므로 이 값만으로 확정하지 않는다.
 * validateMenuItems가 모델이 같은 값을 냈을 때만 신뢰한다.
 */
export function parseThousandNotation(input) {
  if (typeof input !== 'string') return null;

  const text = input
    .normalize('NFKC')
    .replace(/[\s₩\\]/g, '')
    .replace(/원|won|krw/gi, '');

  // "3."처럼 소수점 뒤가 비어 있는 표기도 3.0으로 본다.
  const match = text.match(/^(\d{1,3})[.,](\d{0,3})$/);
  if (!match) return null;

  const value = Math.round(parseFloat(`${match[1]}.${match[2] || '0'}`) * 1000);
  return value >= MIN_PRICE_WON && value <= MAX_PRICE_WON ? value : null;
}

/**
 * Gemini가 돌려준 항목들을 검증한다.
 * 각 항목: { name, price_text, price_won, uncertain }
 *
 * 가격은 서버가 price_text에서 직접 파싱한 값을 우선 사용한다.
 * - 서버 파싱값과 모델 변환값이 다르면 uncertain
 * - 한쪽만 값이 있으면 uncertain
 * - "3.0", "15.9"처럼 천 원 단위 소수로 적힌 표기는 ×1000 후보를 만들고,
 *   모델이 같은 값을 냈을 때만 ok. 모델 값이 없거나 다르면(범위 밖 포함) 후보값을 쓰되 uncertain
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
    // 서버가 못 읽은 소수 표기(3.0, 15.9 ...)는 ×1000 후보를 따로 만든다.
    const thousand = parsed === null ? parseThousandNotation(priceText) : null;

    let price;
    let priceUncertain;
    if (parsed !== null) {
      price = parsed;
      priceUncertain = modelPrice === null || parsed !== modelPrice;
    } else if (thousand !== null) {
      // 사진 속 표기에서 계산한 값을 쓰고, 모델이 같은 값을 냈을 때만 믿는다.
      price = thousand;
      priceUncertain = modelPrice !== thousand;
    } else {
      price = modelPrice;
      priceUncertain = true;
    }

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
        priceUncertain ||
        category === 'unknown'
          ? 'uncertain'
          : 'ok',
    });
  }

  return { items, rejected };
}
