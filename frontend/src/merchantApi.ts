
import { apiUrl } from './apiUrl.ts'
import type { Merchant } from './merchants'

type DbMerchant = {
  // 숫자·문자열 어느 쪽으로 오든 문자열로 통일해서 쓴다.
  merchant_id: string | number
  region: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  category: string
  source_category_code: string | null
  phone: string | null
  naver_cuisine: string | null
  naver_classification: string | null

  weekday_open: string | null
  weekday_close: string | null
  saturday_open: string | null
  saturday_close: string | null
  sunday_open: string | null
  sunday_close: string | null
}

type MerchantResponse = {
  total: number
  merchants: DbMerchant[]
}

// DB의 통합 업종을 기존 지도 색상 분류에 맞춤
function toUiCategory(category: string): string {
  switch (category) {
    case '음식점':
      return '일반음식점'
    case '편의점':
      return '편의점'
    case '제과·간식':
      return '베이커리/간식'
    case '마트·슈퍼':
    case '반찬·식품':
      return '마트'
    default:
      return '미분류'
  }
}

function formatHours(
  open: string | null,
  close: string | null
): string | undefined {
  if (!open || !close) return undefined
  return `${open} ~ ${close}`
}

// 선택 지역의 전체 가맹점을 페이지 단위로 불러오기
export async function loadRegionMerchants(
  region: string,
  signal?: AbortSignal
): Promise<Merchant[]> {
  const allRows: DbMerchant[] = []
  let offset = 0

  while (true) {
    const params = new URLSearchParams({
      region,
      limit: '1000',
      offset: String(offset),
    })

    const response = await fetch(
      apiUrl(`/api/merchants?${params.toString()}`),
      { signal }
    )

    if (!response.ok) {
      throw new Error(`가맹점 조회 실패: HTTP ${response.status}`)
    }

    const data = (await response.json()) as MerchantResponse

    if (
      !Array.isArray(data.merchants) ||
      !Number.isSafeInteger(data.total) ||
      data.total < 0
    ) {
      throw new Error('가맹점 API 응답 형식이 올바르지 않습니다.')
    }

    allRows.push(...data.merchants)
    offset += data.merchants.length

    if (data.merchants.length === 0 || offset >= data.total) {
      break
    }
  }

  return allRows.map((row, index) => {
    const hasCoordinates =
      typeof row.latitude === 'number' &&
      typeof row.longitude === 'number' &&
      Number.isFinite(row.latitude) &&
      Number.isFinite(row.longitude) &&
      row.latitude >= -90 &&
      row.latitude <= 90 &&
      row.longitude >= -180 &&
      row.longitude <= 180
    const weekday = formatHours(row.weekday_open, row.weekday_close)
    const saturday = formatHours(row.saturday_open, row.saturday_close)
    const sunday = formatHours(row.sunday_open, row.sunday_close)
    return {
      // 기존 지도와 TMAP이 숫자형 ID를 사용하므로
      // 화면 내 임시 ID를 부여
      id: index + 1,
      merchantId: String(row.merchant_id),
      name: row.name,
      address: row.address ?? '',
      category: toUiCategory(row.category),
      rawCategory: row.category,
      detailCategory:
        row.naver_cuisine?.trim() ||
        row.source_category_code ||
        row.category,

      ...(row.naver_cuisine?.trim()
        ? { naverCuisine: row.naver_cuisine.trim() }
        : {}),

      ...(row.naver_classification
        ? { naverClassification: row.naver_classification }
        : {}),

      ...(weekday || saturday || sunday
        ? {
            businessHours: {
              ...(weekday ? { weekday } : {}),
              ...(saturday ? { saturday } : {}),
              ...(sunday ? { sunday } : {}),
            },
          }
        : {}),

      ...(hasCoordinates
        ? {
            coordinates: {
              lat: row.latitude as number,
              lng: row.longitude as number,
            },
          }
        : {}),

      // 원본 DB에서 확인되지 않은 항목은 임의 생성하지 않음
      open: false,
      delivery: false,
      menu: [],
      hours: '',
      distance: 0,
      ...(row.phone ? { phone: row.phone } : {}),
    }
  })
}
