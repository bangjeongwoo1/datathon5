import type { Coordinates } from './kakao'
import type { Merchant } from './merchants'

export function buildPersistedPositions(stores: Merchant[]): Map<number, Coordinates> {
  return new Map(
    stores
      .filter((store): store is Merchant & { coordinates: Coordinates } => store.coordinates !== undefined)
      .map((store) => [store.id, store.coordinates]),
  )
}
