import type { MealPrice } from './mealPrice.ts'

export type SourceMerchant = {
  id: number
  name: string
  address: string
  industry: string
  officialBusinessType?: string
  coordinates?: { lat: number; lng: number }
}

export type MerchantRecord = {
  id: number
  // DB의 실제 기본키(merchants.merchant_id, 예: "CC-000001"). 지도 클러스터링 등
  // 기존 로직은 숫자 id를 계속 쓰므로 그대로 두고, 리뷰·메뉴판 사진 제보처럼 DB 행을
  // 정확히 가리켜야 하는 기능은 이 값을 사용한다. 정적 생성 데이터 경로는 값이 없을 수 있음.
  merchantId?: string
  name: string
  address: string
  category: string
  rawCategory: string
  detailCategory: string
  phone?: string
  menu?: string[]
  confirmedMeals?: MealPrice[]
  delivery?: boolean
  coordinates?: { lat: number; lng: number }

  // 승인된 메뉴판 기준 "만원 이하 식사" 여부. Y 있음, N 없음, 값이 없으면 아직 모름.
  under10000?: 'Y' | 'N'
  minMealPriceWon?: number

  // 네이버 크롤링 정보
  naverCuisine?: string
  naverClassification?: string
  businessHours?: {
    weekday?: string
    saturday?: string
    holiday?: string
  }
}

const FOOD_SERVICE_INDUSTRIES = new Set(['한식', '일반대중음식', '중식', '일식', '패스트푸드', '양식'])

export function toUiCategory(industry: string) {
  if (industry === '편의점') return '편의점'
  if (industry === '제과점') return '베이커리/간식'
  if (FOOD_SERVICE_INDUSTRIES.has(industry)) return '일반음식점'
  return '마트'
}

export function toMerchant(source: SourceMerchant): MerchantRecord {
  const industry = source.industry.trim() || '업종 미분류'
  const detail = source.officialBusinessType?.trim() || industry
  return {
    id: source.id,
    name: source.name,
    address: source.address,
    ...(source.coordinates ? { coordinates: source.coordinates } : {}),
    category: toUiCategory(industry),
    rawCategory: industry,
    detailCategory: detail,
  }
}

export function mapCandidateStores<T extends { id: number }>(stores: readonly T[], selectedId: number | null, limit = 60) {
  const selected = selectedId === null ? undefined : stores.find(store => store.id === selectedId)
  const candidates = selected ? [selected, ...stores.filter(store => store.id !== selected.id)] : [...stores]
  return candidates.slice(0, limit)
}
