import { supabase } from './supabaseClient'
import type { ReviewTagCode } from './reviewTags'
import { todayInKst } from './reviewTags'

export type ReviewSummary = {
  reviewCount: number
  avgRating: number | null // 리뷰가 없으면 null ("평가 없음"으로 표시)
}

export type TagCount = { positive: number; negative: number }
export type TagCounts = Record<ReviewTagCode, TagCount>

const EMPTY_TAG_COUNTS: TagCounts = {
  price: { positive: 0, negative: 0 },
  taste: { positive: 0, negative: 0 },
  kindness: { positive: 0, negative: 0 },
  atmosphere: { positive: 0, negative: 0 },
  portion: { positive: 0, negative: 0 },
}

export async function fetchReviewSummary(merchantId: string): Promise<ReviewSummary> {
  const { data, error } = await supabase
    .from('merchant_review_summary')
    .select('review_count, avg_rating')
    .eq('merchant_id', merchantId)
    .maybeSingle()

  if (error) throw error

  return {
    reviewCount: data?.review_count ?? 0,
    avgRating: data?.avg_rating ?? null,
  }
}

// 사이드바 목록 표시·정렬에 쓰기 위해 "리뷰가 1건이라도 있는" 가맹점 전체를 한 번에 조회.
// 지역 전체 가맹점 수가 수천 개라도, 실제 리뷰가 달린 가맹점은 소수이므로
// merchant_id 목록을 넘길 필요 없이(URL 길이 문제 회피) review_count>0 조건만으로 충분하다.
export async function fetchAllReviewSummaries(): Promise<Record<string, ReviewSummary>> {
  const { data, error } = await supabase
    .from('merchant_review_summary')
    .select('merchant_id, review_count, avg_rating')
    .gt('review_count', 0)

  if (error) throw error

  const result: Record<string, ReviewSummary> = {}
  for (const row of data ?? []) {
    result[row.merchant_id as string] = {
      reviewCount: row.review_count ?? 0,
      avgRating: row.avg_rating ?? null,
    }
  }
  return result
}

// 마찬가지로 정렬(평가 항목별 긍정 많은 순)을 위해 태그 집계 전체를 한 번에 조회.
// merchant_tag_counts는 실제 리뷰에서 unnest한 태그만 모은 뷰라 이미 리뷰 없는
// 가맹점은 포함되지 않으므로 별도 필터 없이 전체를 가져와도 작다.
export async function fetchAllTagCounts(): Promise<Record<string, TagCounts>> {
  const { data, error } = await supabase
    .from('merchant_tag_counts')
    .select('merchant_id, tag, positive_count, negative_count')

  if (error) throw error

  const result: Record<string, TagCounts> = {}
  for (const row of data ?? []) {
    const merchantId = row.merchant_id as string
    const code = row.tag as ReviewTagCode
    if (!result[merchantId]) {
      result[merchantId] = {
        price: { ...EMPTY_TAG_COUNTS.price },
        taste: { ...EMPTY_TAG_COUNTS.taste },
        kindness: { ...EMPTY_TAG_COUNTS.kindness },
        atmosphere: { ...EMPTY_TAG_COUNTS.atmosphere },
        portion: { ...EMPTY_TAG_COUNTS.portion },
      }
    }
    result[merchantId][code] = { positive: row.positive_count ?? 0, negative: row.negative_count ?? 0 }
  }
  return result
}

export async function fetchTagCounts(merchantId: string): Promise<TagCounts> {
  const { data, error } = await supabase
    .from('merchant_tag_counts')
    .select('tag, positive_count, negative_count')
    .eq('merchant_id', merchantId)

  if (error) throw error

  const counts: TagCounts = {
    price: { ...EMPTY_TAG_COUNTS.price },
    taste: { ...EMPTY_TAG_COUNTS.taste },
    kindness: { ...EMPTY_TAG_COUNTS.kindness },
    atmosphere: { ...EMPTY_TAG_COUNTS.atmosphere },
    portion: { ...EMPTY_TAG_COUNTS.portion },
  }

  for (const row of data ?? []) {
    const code = row.tag as ReviewTagCode
    if (code in counts) {
      counts[code] = { positive: row.positive_count ?? 0, negative: row.negative_count ?? 0 }
    }
  }

  return counts
}

// 오늘(KST) 이미 리뷰를 작성했는지 확인 (로그인 사용자 기준)
export async function hasReviewedToday(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('review_date', todayInKst())
    .limit(1)

  if (error) throw error
  return (data?.length ?? 0) > 0
}

export type SubmitReviewInput = {
  merchantId: string
  rating: number
  positiveTags: ReviewTagCode[]
  negativeTags: ReviewTagCode[]
}

// user_id/created_at은 일부러 안 보냄 - DB 트리거가 auth.uid()/now()로 강제 설정한다
// (클라이언트가 보낸 값은 트리거가 덮어쓰므로 애초에 보낼 이유가 없고, 보안상 보내면 안 됨)
export async function submitReview(input: SubmitReviewInput): Promise<void> {
  const { error } = await supabase.from('reviews').insert({
    merchant_id: input.merchantId,
    rating: input.rating,
    positive_tags: input.positiveTags,
    negative_tags: input.negativeTags,
  })

  if (error) throw error
}
