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
  name: string
  address: string
  category: string
  rawCategory: string
  detailCategory: string
  coordinates?: { lat: number; lng: number }
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
