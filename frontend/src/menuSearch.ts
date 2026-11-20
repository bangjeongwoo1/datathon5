// 검색창 규칙: 가게 이름·주소·업종에 더해 "승인된 메뉴 이름"으로도 가게를 찾는다.
// - 띄어쓰기는 무시한다. ("김밥 천국" → 김밥천국, "연어덮밥" → 연어 덮밥)
// - 여러 단어면 모든 단어가 (어느 항목에든) 들어 있는 가게만 남긴다.
// 메뉴 이름은 관리자가 승인한 메뉴판에서만 오므로, 메뉴판이 승인된 가게만 메뉴로 찾아진다.

type Searchable = {
  name: string
  address: string
  rawCategory: string
  detailCategory: string
  menuNames?: string[]
}

export function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, '')
}

function searchWords(query: string): string[] {
  return query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)
}

/** 검색어가 가게와 맞는지. 검색어가 비어 있으면 항상 맞다. */
export function matchesSearch(store: Searchable, query: string): boolean {
  const whole = normalizeSearchText(query)
  if (!whole) return true

  const fields = [store.name, store.address, store.rawCategory, store.detailCategory, ...(store.menuNames ?? [])]
    .map(normalizeSearchText)

  if (fields.some(field => field.includes(whole))) return true

  const words = searchWords(query)
  return words.length > 1 && words.every(word => fields.some(field => field.includes(word)))
}

/** 검색어에 걸린 메뉴 이름들(카드에 "메뉴: …"로 보여 주기 위해). 없으면 빈 배열. */
export function matchedMenuNames(store: Pick<Searchable, 'menuNames'>, query: string): string[] {
  const whole = normalizeSearchText(query)
  if (!whole || !store.menuNames?.length) return []
  const words = searchWords(query)
  return store.menuNames.filter(menu => {
    const name = normalizeSearchText(menu)
    return name.includes(whole) || words.some(word => name.includes(word))
  })
}

/** 카드에 붙일 짧은 문구. 예: "메뉴: 라면", "메뉴: 라면 외 2개" */
export function menuMatchLabel(names: string[]): string | null {
  if (!names.length) return null
  return names.length === 1 ? `메뉴: ${names[0]}` : `메뉴: ${names[0]} 외 ${names.length - 1}개`
}
