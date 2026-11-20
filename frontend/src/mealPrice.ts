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
