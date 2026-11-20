import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { REVIEW_TAG_PAIRS } from './reviewTags'
import type { ReviewTagCode } from './reviewTags'
import {
  fetchReviewSummary,
  fetchTagCounts,
  hasReviewedToday,
  submitReview,
} from './reviewApi'
import type { ReviewSummary, TagCounts } from './reviewApi'
import './ReviewPanel.css'

type Mode = 'view' | 'form' | 'success'

// 마우스 위치(별의 왼쪽/오른쪽 절반)에 따라 0.5 단위로 값을 고르는 5성 별점 위젯.
function valueForPointer(starIndex: number, clientX: number, rect: DOMRect): number {
  const isLeftHalf = clientX - rect.left < rect.width / 2
  return isLeftHalf ? starIndex - 0.5 : starIndex
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const displayValue = hover ?? value

  return (
    <div
      className="star-rating"
      role="radiogroup"
      aria-label="별점 선택"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((starIndex) => {
        const fillPercent = Math.max(0, Math.min(100, (displayValue - (starIndex - 1)) * 100))
        return (
          <span
            key={starIndex}
            className="star"
            role="radio"
            aria-checked={value >= starIndex - 0.5 && value < starIndex}
            onMouseMove={(e) => setHover(valueForPointer(starIndex, e.clientX, e.currentTarget.getBoundingClientRect()))}
            onClick={(e) => onChange(valueForPointer(starIndex, e.clientX, e.currentTarget.getBoundingClientRect()))}
          >
            <svg viewBox="0 0 24 24" className="star-outline" aria-hidden="true">
              <path d="M12 2.5 15 9.1 22 10l-5.2 4.9L18.2 22 12 18.3 5.8 22l1.4-7.1L2 10l7-0.9Z" />
            </svg>
            <span className="star-fill" style={{ width: `${fillPercent}%` }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2.5 15 9.1 22 10l-5.2 4.9L18.2 22 12 18.3 5.8 22l1.4-7.1L2 10l7-0.9Z" />
              </svg>
            </span>
          </span>
        )
      })}
      <strong className="star-value">{displayValue.toFixed(1)}</strong>
    </div>
  )
}

export default function ReviewPanel({
  merchantId,
  merchantName,
}: {
  merchantId?: string
  merchantName: string
}) {
  const { user, signInWithGoogle, signingIn } = useAuth()

  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [tagCounts, setTagCounts] = useState<TagCounts | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alreadyReviewedToday, setAlreadyReviewedToday] = useState(false)

  const [mode, setMode] = useState<Mode>('view')
  const [rating, setRating] = useState<number>(5)
  const [positiveTags, setPositiveTags] = useState<ReviewTagCode[]>([])
  const [negativeTags, setNegativeTags] = useState<ReviewTagCode[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // 리뷰 제출 직후(submit) 재사용하는 조회 함수. 마운트 시 자동 조회는
  // 아래 effect에서 직접 Promise 체인으로 수행한다 (effect가 이 함수를 그대로
  // 호출하면 린트가 "effect 안에서 setState 함수를 직접 호출"로 보고 경고함).
  const loadReviewData = async (id: string) => {
    try {
      setLoadError(null)
      const [nextSummary, nextTagCounts] = await Promise.all([
        fetchReviewSummary(id),
        fetchTagCounts(id),
      ])
      setSummary(nextSummary)
      setTagCounts(nextTagCounts)
    } catch (error) {
      console.error('리뷰 정보 조회 오류:', error)
      setLoadError('리뷰 정보를 불러오지 못했습니다.')
    }
  }

  useEffect(() => {
    if (!merchantId) return
    let active = true
    Promise.all([fetchReviewSummary(merchantId), fetchTagCounts(merchantId)])
      .then(([nextSummary, nextTagCounts]) => {
        if (!active) return
        setSummary(nextSummary)
        setTagCounts(nextTagCounts)
      })
      .catch((error) => {
        console.error('리뷰 정보 조회 오류:', error)
        if (active) setLoadError('리뷰 정보를 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [merchantId])

  useEffect(() => {
    if (!user) return
    let active = true
    hasReviewedToday(user.id)
      .then((result) => {
        if (active) setAlreadyReviewedToday(result)
      })
      .catch((error) => console.error('오늘 리뷰 작성 여부 확인 오류:', error))
    return () => {
      active = false
    }
  }, [user, merchantId])

  if (!merchantId) return null

  const toggleTag = (code: ReviewTagCode, side: 'positive' | 'negative') => {
    if (side === 'positive') {
      setPositiveTags((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
      setNegativeTags((prev) => prev.filter((c) => c !== code)) // 같은 항목 반대쪽은 자동 해제
    } else {
      setNegativeTags((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
      setPositiveTags((prev) => prev.filter((c) => c !== code))
    }
  }

  const openForm = () => {
    setRating(5)
    setPositiveTags([])
    setNegativeTags([])
    setSubmitError(null)
    setMode('form')
  }

  const submit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitReview({ merchantId, rating, positiveTags, negativeTags })
      setMode('success')
      setAlreadyReviewedToday(true)
      await loadReviewData(merchantId)
    } catch (error) {
      console.error('리뷰 등록 오류:', error)
      setSubmitError('리뷰 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPairLabel = (code: ReviewTagCode) => {
    const pair = REVIEW_TAG_PAIRS.find((p) => p.code === code)
    if (!pair) return code
    if (positiveTags.includes(code)) return `${pair.positiveEmoji} ${pair.positiveLabel}`
    if (negativeTags.includes(code)) return `${pair.negativeEmoji} ${pair.negativeLabel}`
    return null
  }

  return (
    <div className="review-panel">
      <div className="review-summary">
        {summary === null && !loadError && <span className="review-loading">평가 불러오는 중…</span>}
        {loadError && <span className="review-error">{loadError}</span>}
        {summary && summary.reviewCount > 0 && (
          <span className="review-stars">
            ★ {summary.avgRating?.toFixed(1)} <span>(리뷰 {summary.reviewCount}개)</span>
          </span>
        )}
        {summary && summary.reviewCount === 0 && <span className="review-none">평가 없음</span>}
      </div>

      {tagCounts && (
        <ul className="review-tag-list">
          {REVIEW_TAG_PAIRS.flatMap((pair) => {
            const count = tagCounts[pair.code]
            return [
              <li key={`${pair.code}-pos`} className="tag-positive">
                <span>{pair.positiveEmoji} {pair.positiveLabel}</span>
                <b>+{count.positive}</b>
              </li>,
              <li key={`${pair.code}-neg`} className="tag-negative">
                <span>{pair.negativeEmoji} {pair.negativeLabel}</span>
                <b>-{count.negative}</b>
              </li>,
            ]
          })}
        </ul>
      )}

      {mode === 'view' && (
        <div className="review-cta">
          {!user && (
            <button type="button" onClick={() => void signInWithGoogle()} disabled={signingIn}>
              {signingIn ? '이동 중…' : '로그인하고 리뷰 남기기'}
            </button>
          )}
          {user && alreadyReviewedToday && <p className="review-note">오늘은 이미 리뷰를 작성했습니다. 내일 다시 남겨주세요.</p>}
          {user && !alreadyReviewedToday && (
            <button type="button" onClick={openForm}>
              리뷰 작성하기
            </button>
          )}
        </div>
      )}

      {mode === 'form' && (
        <div className="review-form">
          <strong>{merchantName} 리뷰 작성</strong>

          <StarRating value={rating} onChange={setRating} />

          <div className="tag-picker">
            {REVIEW_TAG_PAIRS.map((pair) => (
              <div key={pair.code} className="tag-pair-row">
                <button
                  type="button"
                  className={`tag-chip positive ${positiveTags.includes(pair.code) ? 'active' : ''}`}
                  onClick={() => toggleTag(pair.code, 'positive')}
                >
                  {pair.positiveEmoji} {pair.positiveLabel}
                </button>
                <button
                  type="button"
                  className={`tag-chip negative ${negativeTags.includes(pair.code) ? 'active' : ''}`}
                  onClick={() => toggleTag(pair.code, 'negative')}
                >
                  {pair.negativeEmoji} {pair.negativeLabel}
                </button>
              </div>
            ))}
          </div>

          <div className="review-confirm">
            선택: ★{rating.toFixed(1)}
            {[...positiveTags, ...negativeTags].length > 0 && (
              <>
                {' · '}
                {[...positiveTags, ...negativeTags]
                  .map((code) => selectedPairLabel(code))
                  .filter(Boolean)
                  .join(', ')}
              </>
            )}
          </div>

          {submitError && <p className="review-error">{submitError}</p>}

          <div className="review-form-actions">
            <button type="button" onClick={() => setMode('view')} disabled={submitting}>
              취소
            </button>
            <button type="button" className="primary" onClick={() => void submit()} disabled={submitting}>
              {submitting ? '등록 중…' : '리뷰 제출'}
            </button>
          </div>
        </div>
      )}

      {mode === 'success' && (
        <div className="review-success">
          <p>리뷰가 등록됐습니다. 감사합니다!</p>
          <button type="button" onClick={() => setMode('view')}>
            확인
          </button>
        </div>
      )}
    </div>
  )
}
