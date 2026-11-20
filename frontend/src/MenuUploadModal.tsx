import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './useAuth'
import { MAX_PHOTOS, addPhotos, categoryLabel, formatWon, submitMenuPhoto } from './menuSubmission'
import type { MenuSubmission } from './menuSubmission'
import './MenuUploadModal.css'

// 로그인이 필요한 기능인지. 로컬 개발에서 로그인 없이 시험하려면
// frontend/.env.local에 VITE_UPLOAD_REQUIRES_LOGIN=false 를 넣는다.
const REQUIRES_LOGIN = import.meta.env?.VITE_UPLOAD_REQUIRES_LOGIN !== 'false'

type Props = {
  merchantId: string // DB의 merchant_id
  merchantName: string
  onClose: () => void
}

type Phase = 'idle' | 'uploading' | 'done'

export default function MenuUploadModal({ merchantId, merchantName, onClose }: Props) {
  const { user, sessionLoading, signingIn, signInWithGoogle } = useAuth()
  // 고른 사진(최대 5장)과 각각의 미리보기 주소. 같은 순서로 맞춰 둔다.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<MenuSubmission | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 창이 닫힐 때 미리보기 메모리를 돌려주기 위해 마지막 사진 목록을 기억해 둔다.
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  const uploading = phase === 'uploading'
  const needLogin = REQUIRES_LOGIN && !user
  const canAddMore = photos.length < MAX_PHOTOS

  useEffect(() => {
    dialogRef.current?.focus()
    return () => {
      // 창이 닫히면 진행 중인 전송을 취소하고 미리보기 메모리를 돌려준다.
      abortRef.current?.abort()
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url)
    }
  }, [])

  const close = () => {
    if (!uploading) onClose()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') close()
  }

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = '' // 같은 사진을 다시 골라도 반응하도록 비운다.
    if (picked.length === 0) return

    const current = photos.map(photo => photo.file)
    const { files, error: problem } = addPhotos(current, picked)
    const added = files.slice(current.length).map(file => ({ file, url: URL.createObjectURL(file) }))
    setPhotos([...photos, ...added])
    setError(problem ?? '')
  }

  const removePhoto = (index: number) => {
    const target = photos[index]
    if (!target) return
    URL.revokeObjectURL(target.url)
    setPhotos(photos.filter((_, i) => i !== index))
    setError('')
  }

  const submit = async () => {
    if (photos.length === 0 || uploading) return

    setError('')
    setPhase('uploading')
    const controller = new AbortController()
    abortRef.current = controller

    try {
      let accessToken: string | null = null
      try {
        const { data } = await supabase.auth.getSession()
        accessToken = data.session?.access_token ?? null
      } catch {
        accessToken = null
      }

      const submission = await submitMenuPhoto({
        merchantId,
        files: photos.map(photo => photo.file),
        accessToken,
        signal: controller.signal,
      })
      setResult(submission)
      setPhase('done')
    } catch (caught) {
      if (controller.signal.aborted) return // 창을 닫은 경우
      setError(caught instanceof Error ? caught.message : '사진을 제출하지 못했어요.')
      setPhase('idle')
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={dialogRef}
        className="menu-upload"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-upload-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={event => event.stopPropagation()}
      >
        <header className="menu-upload-head">
          <div>
            <h2 id="menu-upload-title">메뉴판 사진 올리기</h2>
            <p className="menu-upload-store">{merchantName}</p>
          </div>
          <button type="button" aria-label="닫기" onClick={close} disabled={uploading}>
            ×
          </button>
        </header>

        {phase === 'done' && result ? (
          <div className="menu-upload-body">
            <p className="menu-upload-success" role="status">
              제출했어요! 관리자가 확인한 뒤에 지도에 반영돼요.
            </p>
            <p className="menu-upload-hint">
              AI가 읽은 결과예요. 확인 전까지는 다른 사람에게 보이지 않아요.
            </p>

            <ul className="menu-upload-items">
              {result.items.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <span className="menu-upload-item-name">{item.name}</span>
                  <span className="menu-upload-item-tag">{categoryLabel(item.category)}</span>
                  {(result.photo_count ?? 1) > 1 && item.photo && (
                    <span className="menu-upload-item-tag">사진 {item.photo}</span>
                  )}
                  <strong>{formatWon(item.price_won)}</strong>
                  {item.status === 'uncertain' && (
                    <span className="menu-upload-badge">확인 필요</span>
                  )}
                </li>
              ))}
            </ul>
            {result.rejected.length > 0 && (
              <p className="menu-upload-hint">
                읽지 못한 항목 {result.rejected.length}개는 제외됐어요.
              </p>
            )}

            <div className="menu-upload-actions">
              <button type="button" className="primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        ) : needLogin ? (
          <div className="menu-upload-body">
            {sessionLoading ? (
              <p className="menu-upload-hint">로그인 상태를 확인하고 있어요…</p>
            ) : (
              <>
                <p>메뉴판 사진을 올리려면 로그인이 필요해요.</p>
                <p className="menu-upload-hint">
                  누가 올렸는지 확인할 수 있어야 잘못된 정보를 막을 수 있어요.
                </p>
                <div className="menu-upload-actions">
                  <button type="button" onClick={onClose}>
                    취소
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={signInWithGoogle}
                    disabled={signingIn}
                  >
                    {signingIn ? '이동 중…' : 'Google로 로그인'}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="menu-upload-body">
            <ul className="menu-upload-guide">
              <li>메뉴 이름과 가격이 잘 보이게 찍어 주세요.</li>
              <li>메뉴판이 여러 장이면 한 번에 최대 {MAX_PHOTOS}장까지 같이 올려 주세요.</li>
              <li>메뉴판만 찍어 주세요. 사람 얼굴이나 개인정보가 나오지 않게 해 주세요.</li>
              <li>제출한 사진은 관리자가 확인한 뒤에 삭제돼요.</li>
            </ul>

            <input
              ref={inputRef}
              className="menu-upload-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={pickFiles}
              tabIndex={-1}
              aria-hidden="true"
            />

            {photos.length > 0 ? (
              <ol className="menu-upload-thumbs" aria-label={`고른 사진 ${photos.length}장`}>
                {photos.map((photo, index) => (
                  <li key={photo.url}>
                    <img src={photo.url} alt={`${index + 1}번째 메뉴판 사진`} />
                    <span className="menu-upload-thumb-no">{index + 1}</span>
                    <button
                      type="button"
                      className="menu-upload-thumb-remove"
                      aria-label={`${index + 1}번째 사진 빼기`}
                      onClick={() => removePhoto(index)}
                      disabled={uploading}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <button
                type="button"
                className="menu-upload-drop"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                사진 선택하기 (최대 {MAX_PHOTOS}장, 한 장당 5MB 이하, JPG·PNG·WEBP)
              </button>
            )}

            {error && (
              <p className="menu-upload-error" role="alert">
                {error}
              </p>
            )}
            {uploading && (
              <p className="menu-upload-hint" role="status">
                {photos.length > 1
                  ? `메뉴판 사진 ${photos.length}장을 읽고 있어요… 몇 분 걸릴 수 있어요. 창을 닫지 말아 주세요.`
                  : '메뉴판을 읽고 있어요… 최대 1분 정도 걸릴 수 있어요. 창을 닫지 말아 주세요.'}
              </p>
            )}

            <div className="menu-upload-actions">
              {photos.length > 0 && canAddMore && (
                <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
                  사진 추가 ({photos.length}/{MAX_PHOTOS})
                </button>
              )}
              <button type="button" onClick={onClose} disabled={uploading}>
                취소
              </button>
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={photos.length === 0 || uploading}
              >
                {uploading ? '분석 중…' : photos.length > 1 ? `${photos.length}장 제출하기` : '제출하기'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
