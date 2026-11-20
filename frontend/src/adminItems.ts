// 관리자 검수 화면에서 메뉴 목록을 고칠 때 쓰는 계산. 화면과 분리해 브라우저 없이 테스트한다.
import type { MenuCategory, SubmittedItem } from './menuSubmission.ts'

export const MIN_PRICE_WON = 500
export const MAX_PRICE_WON = 100_000
export const UNDER_LIMIT_WON = 10_000 // "만원 이하" 기준(이 금액 포함)

export type DraftItem = {
  key: number // 화면 목록용 번호. 서버로 보내지 않는다.
  name: string
  price: string // 입력창 값 그대로(숫자만 남기지는 않는다)
  category: MenuCategory
  uncertain: boolean // AI가 확신하지 못한 항목: 사람이 꼭 눈으로 확인해야 한다.
  photo?: number // 몇 번째 사진(1부터)에서 읽었는지. 사진이 여러 장일 때 화면에 표시한다.
}

export type ApprovedItem = { name: string; price_won: number; category: Exclude<MenuCategory, 'unknown'> }

let nextKey = 1

/** 서버가 준 OCR 결과를 고칠 수 있는 목록으로 바꾼다. */
export function toDrafts(items: SubmittedItem[]): DraftItem[] {
  return items.map((item) => ({
    key: nextKey++,
    name: item.name,
    price: String(item.price_won),
    category: item.category,
    uncertain: item.status === 'uncertain',
    ...(item.photo ? { photo: item.photo } : {}),
  }))
}

export function emptyDraft(): DraftItem {
  return { key: nextKey++, name: '', price: '', category: 'meal', uncertain: false }
}

/** "9,000" "9000원" 같은 입력을 정수로. 숫자가 아니면 null. */
export function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[,\s원]/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isSafeInteger(value) ? value : null
}

/** 한 줄의 문제를 한글로. 괜찮으면 null. */
export function validateDraft(draft: DraftItem): string | null {
  if (!draft.name.trim()) return '메뉴 이름을 입력해 주세요.'
  if (draft.name.trim().length > 100) return '메뉴 이름이 너무 깁니다.'
  const price = parsePriceInput(draft.price)
  if (price === null) return '가격은 숫자로 입력해 주세요.'
  if (price < MIN_PRICE_WON || price > MAX_PRICE_WON) {
    return `가격은 ${MIN_PRICE_WON.toLocaleString('ko-KR')}~${MAX_PRICE_WON.toLocaleString('ko-KR')}원 사이여야 합니다.`
  }
  if (draft.category === 'unknown') return '분류(식사·사이드·음료·주류)를 골라 주세요.'
  return null
}

/** 승인 전 최종 검사. 문제가 없으면 서버로 보낼 목록을, 있으면 이유를 돌려준다. */
export function buildApproval(
  drafts: DraftItem[],
): { ok: true; items: ApprovedItem[] } | { ok: false; error: string } {
  if (drafts.length === 0) return { ok: false, error: '승인할 메뉴가 없어요. 메뉴를 한 개 이상 남겨 주세요.' }
  for (const [index, draft] of drafts.entries()) {
    const problem = validateDraft(draft)
    if (problem) return { ok: false, error: `${index + 1}번째 메뉴: ${problem}` }
  }
  return {
    ok: true,
    items: drafts.map((draft) => ({
      name: draft.name.trim(),
      price_won: parsePriceInput(draft.price) as number,
      category: draft.category as ApprovedItem['category'],
    })),
  }
}

/** 승인하면 이 가게가 "만원 이하 식사 있음(Y)"인지 미리 보여 주기 위한 계산. 식사가 없으면 null(모름). */
export function previewUnder10000(items: ApprovedItem[]): 'Y' | 'N' | null {
  const meals = items.filter((item) => item.category === 'meal')
  if (meals.length === 0) return null
  return meals.some((item) => item.price_won <= UNDER_LIMIT_WON) ? 'Y' : 'N'
}

// ---- 승인 방식(추가/교체) ----
// 서버(backend/menuAdmin.js)의 규칙과 같다: 이름은 띄어쓰기·대소문자를 무시하고 비교한다.

export type ApproveMode = 'merge' | 'replace'

export type CurrentMenu = { name: string; price_won: number; category: string }

export function normalizeMenuName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

export type MergeResult = {
  items: { name: string; price_won: number; category: string }[] // 승인 후 이 가게에 남을 메뉴
  added: number // 새로 더해지는 메뉴
  updated: number // 이름이 같아서 새 가격·분류로 바뀌는 메뉴
  kept: number // 이번 목록에 없어서 그대로 남는 기존 메뉴
  removed: number // 교체 모드에서 지워지는 기존 메뉴
}

/** 승인하면 이 가게 메뉴가 어떻게 되는지 미리 계산한다. */
export function previewApproval(current: CurrentMenu[], approved: ApprovedItem[], mode: ApproveMode): MergeResult {
  // 같은 이름이 목록에 두 번 있으면 마지막 것을 쓴다(서버와 같음).
  const incoming = new Map<string, ApprovedItem>()
  for (const item of approved) incoming.set(normalizeMenuName(item.name), item)

  if (mode === 'replace') {
    return { items: [...incoming.values()], added: incoming.size, updated: 0, kept: 0, removed: current.length }
  }

  const existingNames = new Set(current.map(menu => normalizeMenuName(menu.name)))
  const kept = current.filter(menu => !incoming.has(normalizeMenuName(menu.name)))
  const updated = [...incoming.keys()].filter(key => existingNames.has(key)).length
  return {
    items: [...kept, ...incoming.values()],
    added: incoming.size - updated,
    updated,
    kept: kept.length,
    removed: 0,
  }
}
