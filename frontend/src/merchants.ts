import { sourceMerchants } from './data/merchants.generated.ts'
import { toMerchant } from './merchantData.ts'
import type { MerchantRecord } from './merchantData.ts'
import { matchesCuisine } from './cuisineFilter.ts'
import type { CuisineType } from './cuisineFilter.ts'

export type Merchant = MerchantRecord

export const merchants: Merchant[] = sourceMerchants.map(toMerchant)

export type Filters = {
  query: string
  category: string
  cuisine?: CuisineType | null
  // true 면 승인된 메뉴판에서 만원 이하 식사가 확인된(Y) 가게만. 모르는 가게(값 없음)는 제외한다.
  underTenOnly?: boolean
}


export function filterMerchants(
  items: Merchant[],
  filters: Filters
) {
  const query = filters.query.trim().toLocaleLowerCase()

  return items.filter(store => {
    const categoryMatches =
      filters.category === '전체' ||
      store.category === filters.category

    const searchable = [
      store.name,
      store.address,
      store.rawCategory,
      store.detailCategory,
    ].join(' ').toLocaleLowerCase()

    const cuisineMatches = !filters.cuisine || matchesCuisine(store, filters.cuisine)
    const underTenMatches = !filters.underTenOnly || store.under10000 === 'Y'

    return categoryMatches && cuisineMatches && underTenMatches && searchable.includes(query)
  })
}
