export const LIST_PAGE_SIZE = 30

export function merchantPage<T extends { id: number }>(stores: readonly T[], limit: number, selectedId: number | null): T[] {
  const page = stores.slice(0, limit)
  // 지도에서 고른 매장은 아직 펼치지 않은 목록에 있어도 바로 확인할 수 있게 한다.
  if (selectedId !== null && !page.some(store => store.id === selectedId)) {
    const selected = stores.find(store => store.id === selectedId)
    if (selected) page.unshift(selected)
  }
  return page
}
