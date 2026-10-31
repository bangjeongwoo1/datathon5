import type { Coordinates } from './kakao.ts'

export function straightDistanceMeters(from: Coordinates, to: Coordinates): number {
  const radians = (value: number) => value * Math.PI / 180
  const a = Math.sin(radians(to.lat - from.lat) / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat))
    * Math.sin(radians(to.lng - from.lng) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

export function withDistances<T extends { coordinates?: Coordinates }>(stores: readonly T[], origin: Coordinates | null) {
  return stores.map(store => ({ ...store, distanceMeters: origin && store.coordinates ? straightDistanceMeters(origin, store.coordinates) : null }))
}

export function sortByDistance<T extends { distanceMeters: number | null }>(stores: readonly T[]): T[] {
  return [...stores].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
}

export function formatStraightDistance(meters: number): string {
  return `직선거리 ${meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`}`
}
