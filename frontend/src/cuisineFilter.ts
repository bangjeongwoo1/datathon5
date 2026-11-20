import type { MerchantRecord } from './merchantData.ts'

// 기존 데이터에 존재하는 음식 업종만 버튼으로 사용한다.
// 새 DB 카테고리를 만드는 것이 아니라 네이버/공공데이터의 세부 업종 표기를 묶는다.
export const CUISINE_OPTIONS = ['한식', '중식', '일식', '양식', '분식'] as const
export type CuisineType = (typeof CUISINE_OPTIONS)[number]

const ALIASES: Record<CuisineType, readonly string[]> = {
  한식: ['한식', '한정식', '백반', '국밥', '설렁탕', '삼계탕', '찌개', '냉면'],
  중식: ['중식', '중국식', '중화요리', '짜장', '짬뽕', '마라탕', '훠궈', '딤섬'],
  일식: ['일식', '일본식', '초밥', '스시', '라멘', '우동', '소바', '돈카츠', '돈가스', '돈까스', '가츠동', '규동', '텐동'],
  양식: ['양식', '경양식', '이탈리안', '파스타', '리조또', '스테이크', '피자'],
  분식: ['분식', '김밥', '떡볶이', '라볶이', '순대'],
}

const normalize = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s·_\-]/g, '')

function matchingTypes(detail: string | undefined): CuisineType[] {
  if (!detail?.trim()) return []
  const normalized = normalize(detail)
  return CUISINE_OPTIONS.filter(cuisine =>
    ALIASES[cuisine].some(alias => normalized.includes(normalize(alias)))
  )
}

/**
 * 가게 이름이 아니라 업종 필드만 사용한다.
 * 네이버에서 확인된 세부 업종을 우선하고, 없으면 공공데이터 세부/기본 업종을 사용한다.
 * 해당 정보가 없으면 추측하여 분류하지 않는다(메뉴판 데이터는 아직 미연동).
 */
export function matchesCuisine(store: MerchantRecord, cuisine: CuisineType): boolean {
  const naverMatches = matchingTypes(store.naverCuisine)
  if (naverMatches.length) return naverMatches.includes(cuisine)

  const detailMatches = matchingTypes(store.detailCategory)
  if (detailMatches.length) return detailMatches.includes(cuisine)

  return matchingTypes(store.rawCategory).includes(cuisine)
}
