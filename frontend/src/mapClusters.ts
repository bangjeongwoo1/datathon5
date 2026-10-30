/** Scope affects the sidebar only. The map retains all search/filter matches. */
export function scopeMerchants<T extends { id: number }>(stores: T[], ids: readonly number[] | null): T[] {
  if (ids === null) return stores
  const members = new Set(ids)
  return stores.filter(store => members.has(store.id))
}

/** Snapshot the clicked cluster before zoom triggers the SDK to regroup markers. */
export function selectCluster<Marker extends object, Position>(
  cluster: { getMarkers(): Marker[]; getCenter(): Position },
  markerIds: ReadonlyMap<Marker, number>,
  map: { getLevel(): number; setLevel(level: number): void; panTo(position: Position): void },
  onSelect: (ids: number[]) => void,
) {
  const ids = [...new Set(cluster.getMarkers().flatMap(marker => {
    const id = markerIds.get(marker)
    return id === undefined ? [] : [id]
  }))]
  if (!ids.length) return
  const center = cluster.getCenter()
  onSelect(ids)
  map.setLevel(Math.max(1, map.getLevel() - 1))
  map.panTo(center)
}
