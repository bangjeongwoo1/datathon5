// backend/sql/001_reviews.sql의 review_tag enum과 1:1로 맞춰야 한다.
export type ReviewTagCode = 'price' | 'taste' | 'kindness' | 'atmosphere' | 'portion'

export type TagPair = {
  code: ReviewTagCode
  positiveLabel: string
  negativeLabel: string
  positiveEmoji: string
  negativeEmoji: string
}

export const REVIEW_TAG_PAIRS: TagPair[] = [
  { code: 'price', positiveLabel: '가격이 좋아요', negativeLabel: '가격이 비싸요', positiveEmoji: '💰', negativeEmoji: '💸' },
  { code: 'taste', positiveLabel: '음식이 맛있어요', negativeLabel: '음식이 맛없어요', positiveEmoji: '😋', negativeEmoji: '🤢' },
  { code: 'kindness', positiveLabel: '친절해요', negativeLabel: '불친절해요', positiveEmoji: '😊', negativeEmoji: '😠' },
  { code: 'atmosphere', positiveLabel: '분위기가 좋았어요', negativeLabel: '분위기가 별로에요', positiveEmoji: '✨', negativeEmoji: '😕' },
  { code: 'portion', positiveLabel: '양이 넉넉해요', negativeLabel: '양이 적어요', positiveEmoji: '🍚', negativeEmoji: '😟' },
]

// 0.5 ~ 5.0, 0.5 단위 10개
export const RATING_OPTIONS: number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * 0.5)

export function formatNetScore(positive: number, negative: number): string {
  const net = positive - negative
  if (net > 0) return `+${net}`
  if (net < 0) return `${net}`
  return '0'
}

// 하루 제한 판단에 쓰는 KST 기준 오늘 날짜(YYYY-MM-DD)
export function todayInKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
