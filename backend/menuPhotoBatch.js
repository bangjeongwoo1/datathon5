// 메뉴판 사진 여러 장(최대 5장)을 한 제보로 처리한다.
// Gemini 에는 사진을 한 장씩 따로 보낸다. (한 요청에 여러 장을 넣으면 요청 크기 20MB 제한에 걸릴 수 있고,
// 한 장 처리 코드는 재시도·예비 모델 전환까지 이미 검증되어 있다.) 그 결과를 하나로 합친다.
import { normalizeMenuName } from './menuAdmin.js';

export const MAX_MENU_PHOTOS = 5;
const DEFAULT_CONCURRENCY = 2; // 동시에 보내는 장수. 너무 많으면 분당 호출 제한에 걸리기 쉽다.

/** items 를 최대 limit 개씩 동시에 처리한다. 결과는 입력 순서를 지킨다. 하나라도 실패하면 그 오류를 던진다. */
export async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * 사진별 OCR 결과를 하나로 합친다. 각 메뉴에는 몇 번째 사진(1부터)에서 읽었는지 photo 를 붙인다.
 * - 이름(띄어쓰기·대소문자 무시)과 가격이 같은 메뉴가 여러 사진에 나오면 하나만 남긴다.
 * - 이름은 같은데 가격이 다르면 둘 다 남기고 '확인 필요(uncertain)'로 표시한다. 관리자가 고른다.
 */
export function mergeOcrResults(results) {
  const items = [];
  const rejected = [];
  const models = new Set();
  const byName = new Map(); // 정규화한 이름 -> 지금까지 남긴 같은 이름 메뉴들

  results.forEach((result, index) => {
    const photo = index + 1;
    if (result?.model) models.add(result.model);
    for (const entry of result?.rejected ?? []) rejected.push({ ...entry, photo });

    for (const item of result?.items ?? []) {
      const key = normalizeMenuName(item.name);
      const same = byName.get(key) ?? [];
      if (same.some(kept => kept.price_won === item.price_won)) continue; // 다른 사진에 똑같이 나온 메뉴

      const merged = { ...item, photo };
      if (same.length) {
        // 같은 이름인데 가격이 다르다: 모두 확인 필요로 바꾼다.
        merged.status = 'uncertain';
        for (const kept of same) kept.status = 'uncertain';
      }
      same.push(merged);
      byName.set(key, same);
      items.push(merged);
    }
  });

  return { items, rejected, model: [...models].join(', ') || null };
}

/**
 * 사진 여러 장을 OCR 하고 결과를 합친다. 어느 한 장이라도 AI 호출이 실패하면 그 오류를 그대로 던진다.
 * (일부 사진만 반영된 채 저장되면 관리자가 빠진 메뉴를 알아채기 어렵기 때문이다.)
 */
export async function extractMenusFromPhotos(photos, extract, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const results = await mapWithLimit(photos, concurrency, photo => extract(photo.buffer, photo.mimeType));
  return { ...mergeOcrResults(results), photoCount: photos.length };
}
