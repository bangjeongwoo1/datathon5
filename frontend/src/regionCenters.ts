// 지역(춘천시·원주시·강릉시·홍천군)의 지도 중심과, 내 위치가 어느 지역인지 고르는 계산.
import type { Coordinates } from './kakao.ts'
import { straightDistanceMeters } from './merchantDistance.ts'

export const REGION_CENTERS: Record<string, Coordinates> = {
  춘천시: { lat: 37.8813, lng: 127.73 },
  원주시: { lat: 37.3422, lng: 127.9202 },
  강릉시: { lat: 37.7519, lng: 128.8761 },
  홍천군: { lat: 37.6974, lng: 127.8885 },
}

export const DEFAULT_CENTER: Coordinates = REGION_CENTERS['춘천시'] // 춘천시청

export function getRegionCenter(region: string): Coordinates {
  return REGION_CENTERS[region] ?? DEFAULT_CENTER
}

// 지역 중심에서 이 거리(40km) 안이면 그 지역에 있다고 본다. 가장 가까운 지역 중심을 고르되,
// 어느 지역과도 이보다 멀면(예: 서울) 지역을 바꾸지 않는다.
export const REGION_MATCH_METERS = 40_000

/** 지역 이름 뒤에 붙이는 "~이라/라": 받침이 있으면 "홍천군이라", 없으면 "춘천시라". */
export function withIra(region: string): string {
  const last = region.charCodeAt(region.length - 1)
  const hasFinalConsonant = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0
  return `${region}${hasFinalConsonant ? '이라' : '라'}`
}

/** 내 위치와 가장 가까운 지역. 모든 지역이 기준보다 멀면 null. */
export function nearestRegion(
  location: Coordinates,
  maxMeters = REGION_MATCH_METERS,
): { region: string; distanceMeters: number } | null {
  let best: { region: string; distanceMeters: number } | null = null
  for (const [region, center] of Object.entries(REGION_CENTERS)) {
    const distanceMeters = straightDistanceMeters(location, center)
    if (distanceMeters <= maxMeters && (!best || distanceMeters < best.distanceMeters)) {
      best = { region, distanceMeters }
    }
  }
  return best
}
