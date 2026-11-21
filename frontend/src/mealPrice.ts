export type MealPrice = { name: string; price: number; preview?: true }

export function parseConfirmedMeals(value: unknown): MealPrice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() ||
        !Number.isSafeInteger(item.price) || item.price <= 0 || item.price > 1000000 ||
        item.preview === true) return []
    return [{ name: item.name.trim(), price: item.price }]
  })
}

export function mealsWithinBudget(meals: MealPrice[] | undefined, maximum: number | null) {
  return (meals ?? []).filter(meal =>
    Number.isSafeInteger(meal.price) && meal.price > 0 &&
    (maximum === null || meal.price <= maximum),
  )
}

/**
 * 가게 상세 창에 보여 줄 식사 메뉴. 가격 필터("만 원 이하" 등)가 켜져 있으면(maximum 이 숫자) 그 금액 이하만 보여 주고,
 * 숨긴 메뉴가 몇 개인지 함께 알려 준다. 필터가 꺼져 있으면(null) 승인된 메뉴를 모두 보여 준다.
 */
export function mealsForDetail(
  meals: MealPrice[] | undefined,
  maximum: number | null,
): { shown: MealPrice[]; hiddenCount: number } {
  const all = meals ?? []
  if (maximum === null) return { shown: all, hiddenCount: 0 }
  const shown = mealsWithinBudget(all, maximum)
  return { shown, hiddenCount: all.filter(meal => Number.isSafeInteger(meal.price) && meal.price > maximum).length }
}
