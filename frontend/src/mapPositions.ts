import type { Coordinates } from './kakao'
import type { Merchant } from './merchants'

export type ViewportBounds = { south: number; west: number; north: number; east: number }

export function buildPersistedPositions(stores: Merchant[]): Map<number, Coordinates> {
  return new Map(
    stores
      .filter((store): store is Merchant & { coordinates: Coordinates } => store.coordinates !== undefined)
      .map((store) => [store.id, store.coordinates]),
  )
}

export function filterStoresInBounds(stores: Merchant[], positions: Map<number, Coordinates>, bounds: ViewportBounds): Merchant[] {
  return stores.filter((store) => {
    const point = positions.get(store.id)
    return point !== undefined
      && point.lat >= bounds.south
      && point.lat <= bounds.north
      && point.lng >= bounds.west
      && point.lng <= bounds.east
  })
}
