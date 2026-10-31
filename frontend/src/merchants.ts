import { sourceMerchants } from './data/merchants.generated.ts'
import { toMerchant } from './merchantData.ts'
import type { MerchantRecord } from './merchantData.ts'

export type Merchant = MerchantRecord

export const merchants: Merchant[] = sourceMerchants.map(toMerchant)

export type Filters = { query: string; category: string; distance?: boolean }

export function filterMerchants(items: Merchant[], filters: Filters) {
  const query = filters.query.trim().toLocaleLowerCase()
  return items.filter(store => {
    const categoryMatches = filters.category === '전체' || (filters.category === '마트' ? store.category === '마트' : store.rawCategory === filters.category)
    const searchable = `${store.name} ${store.address} ${store.rawCategory} ${store.detailCategory}`.toLocaleLowerCase()
    return categoryMatches && searchable.includes(query)
  })
}
