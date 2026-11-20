import { useCallback, useEffect, useState } from 'react'
import {
  AdminApiError,
  approveSubmission,
  fetchMe,
  fetchPhotoBlob,
  fetchSubmission,
  fetchSubmissions,
  rejectSubmission,
  type MeInfo,
  type SubmissionDetail,
  type SubmissionStatus,
  type SubmissionSummary,
} from '../adminApi.ts'
import {
  buildApproval,
  emptyDraft,
  previewApproval,
  previewUnder10000,
  toDrafts,
  validateDraft,
  type ApproveMode,
  type ApprovedItem,
  type DraftItem,
} from '../adminItems.ts'
import { categoryLabel, type MenuCategory } from '../menuSubmission.ts'
import { supabase } from '../supabaseClient.ts'
import { useAuth } from '../useAuth.ts'

const TABS: { status: SubmissionStatus; label: string }[] = [
  { status: 'pending', label: '검수 대기' },
  { status: 'approved', label: '승인됨' },
  { status: 'rejected', label: '반려됨' },
]
const CATEGORIES: MenuCategory[] = ['meal', 'side', 'drink', 'alcohol', 'unknown']

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AdminApiError('로그인이 만료되었어요. 다시 로그인해 주세요.', 401)
  return token
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '알 수 없는 오류가 발생했어요.'

export default function AdminApp() {
  const { user, sessionLoading, signingIn, authError, signInWithGoogle, signOut } = useAuth()
  const [me, setMe] = useState<MeInfo | null>(null)
  const [meError, setMeError] = useState<{ status: number; message: string } | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    getToken()
      .then((token) => fetchMe({ token }))
      .then((info) => active && (setMe(info), setMeError(null)))
      .catch((error: unknown) => {
        if (!active) return
        setMe(null)
        setMeError({
          status: error instanceof AdminApiError ? error.status : 0,
          message: messageOf(error),
        })
      })
    return () => {
      active = false
    }
  }, [user])

  let body
  if (sessionLoading) {
    body = <p className="admin-note">불러오는 중…</p>
  } else if (!user) {
    body = (
      <div className="admin-card">
        <p>관리자 검수는 로그인한 관리자만 사용할 수 있어요.</p>
        <button className="admin-primary" onClick={signInWithGoogle} disabled={signingIn}>
          {signingIn ? '구글로 이동 중…' : '구글로 로그인'}
        </button>
        {authError && <p className="admin-error">{authError}</p>}
      </div>
    )
  } else if (meError) {
    body = (
      <div className="admin-card">
        <p className="admin-error">{meError.message}</p>
        {meError.status === 503 && (
          <p className="admin-note">
            서버 <code>backend/.env</code>에 <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>가 있는지
            확인하고 서버를 다시 켜 주세요.
          </p>
        )}
      </div>
    )
  } else if (!me) {
    body = <p className="admin-note">확인하는 중…</p>
  } else if (!me.isAdmin) {
    body = (
      <div className="admin-card">
        <p className="admin-error">이 계정은 관리자가 아니에요.</p>
        <p>
          지금 로그인한 이메일: <strong>{me.email}</strong>
        </p>
        <p className="admin-note">
          본인이 관리자라면 <code>backend/.env</code>의 <code>ADMIN_EMAILS={me.email}</code> 로 적고, 백엔드 서버를
          껐다 켠 뒤 이 페이지를 새로고침하세요.
        </p>
      </div>
    )
  } else {
    body = <Review />
  }

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>잇다 관리자 검수</h1>
        {user && (
          <div className="admin-user">
            <span>{me?.email ?? user.email}</span>
            <button onClick={signOut}>로그아웃</button>
          </div>
        )}
      </header>
      {body}
    </div>
  )
}

function Review() {
  const [status, setStatus] = useState<SubmissionStatus>('pending')
  const [list, setList] = useState<SubmissionSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const reload = useCallback(async () => {
    try {
      setListError(null)
      setList(await fetchSubmissions(status, { token: await getToken() }))
    } catch (error) {
      setListError(messageOf(error))
    }
  }, [status])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 목록 불러오기
    void reload()
  }, [reload])

  const changeTab = (next: SubmissionStatus) => {
    setStatus(next)
    setSelected(null)
    setList(null)
  }

  return (
    <div className="admin-layout">
      <aside className="admin-list">
        <div className="admin-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.status}
              className={tab.status === status ? 'on' : ''}
              onClick={() => changeTab(tab.status)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {listError && <p className="admin-error">{listError}</p>}
        {list === null && !listError && <p className="admin-note">불러오는 중…</p>}
        {list?.length === 0 && <p className="admin-note">해당하는 제보가 없어요.</p>}
        <ul>
          {list?.map((row) => (
            <li key={row.submission_id}>
              <button
                className={row.submission_id === selected ? 'row on' : 'row'}
                onClick={() => setSelected(row.submission_id)}
              >
                <strong>{row.merchant_name ?? `가게 ${row.merchant_id}`}</strong>
                <span>
                  메뉴 {row.item_count}개{row.has_uncertain ? ' · 확인 필요' : ''}
                </span>
                <span className="admin-note">{new Date(row.created_at).toLocaleString('ko-KR')}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="admin-detail">
        {selected === null ? (
          <p className="admin-note">왼쪽에서 제보를 골라 주세요.</p>
        ) : (
          <Detail
            key={selected}
            id={selected}
            onDone={() => {
              setSelected(null)
              void reload()
            }}
          />
        )}
      </main>
    </div>
  )
}

function Detail({ id, onDone }: { id: number; onDone: () => void }) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  // 사진은 최대 5장. 장마다 불러온 주소(실패하면 null)와 지금 크게 보는 사진 번호.
  const [photoUrls, setPhotoUrls] = useState<(string | null)[]>([])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoIndex, setPhotoIndex] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 기본은 "기존 메뉴에 추가": 메뉴판이 여러 장인 가게에서 앞서 승인한 메뉴가 지워지지 않게 한다.
  const [mode, setMode] = useState<ApproveMode>('merge')

  useEffect(() => {
    let active = true
    const urls: string[] = []
    ;(async () => {
      try {
        const token = await getToken()
        const loaded = await fetchSubmission(id, { token })
        if (!active) return
        setDetail(loaded)
        setDrafts(toDrafts(loaded.items))
        const count = loaded.photo_count ?? (loaded.has_photo ? 1 : 0)
        if (count > 0) {
          // 장마다 따로 불러온다. 한 장이 실패해도 나머지는 보여 준다.
          const loadedUrls = await Promise.all(
            Array.from({ length: count }, async (_, index) => {
              try {
                const url = URL.createObjectURL(await fetchPhotoBlob(id, { token }, index))
                urls.push(url)
                return url
              } catch (photoProblem) {
                if (active) setPhotoError(messageOf(photoProblem))
                return null
              }
            }),
          )
          if (active) setPhotoUrls(loadedUrls)
        }
      } catch (loadProblem) {
        if (active) setError(messageOf(loadProblem))
      }
    })()
    return () => {
      active = false
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [id])

  if (error && !detail) return <p className="admin-error">{error}</p>
  if (!detail) return <p className="admin-note">불러오는 중…</p>

  const pending = detail.status === 'pending'
  const currentMenus = detail.current_menus ?? []
  const built = buildApproval(drafts)
  const result = built.ok ? previewApproval(currentMenus, built.items, mode) : null
  const preview = result ? previewUnder10000(result.items as ApprovedItem[]) : null
  const storeName = detail.merchant_name ?? detail.merchant_id
  const update = (key: number, patch: Partial<DraftItem>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  const act = async (kind: 'approve' | 'reject') => {
    setError(null)
    if (kind === 'approve') {
      if (!built.ok || !result) return setError(built.ok ? '승인할 메뉴를 확인해 주세요.' : built.error)
      const question =
        mode === 'merge'
          ? `"${storeName}"에 메뉴를 추가합니다. 새 메뉴 ${result.added}개, 가격·분류가 바뀌는 메뉴 ${result.updated}개, 그대로 남는 메뉴 ${result.kept}개 → 총 ${result.items.length}개. 승인할까요?`
          : `"${storeName}"의 기존 메뉴 ${result.removed}개를 모두 지우고 이 ${result.items.length}개로 교체합니다. 승인할까요?`
      if (!window.confirm(question)) return
    } else if (!window.confirm('이 제보를 반려할까요?')) {
      return
    }
    setBusy(true)
    try {
      const token = await getToken()
      if (kind === 'approve' && built.ok) {
        await approveSubmission(id, { items: built.items, note, mode }, { token })
      } else {
        await rejectSubmission(id, { note }, { token })
      }
      onDone()
    } catch (problem) {
      setError(messageOf(problem))
      setBusy(false)
    }
  }

  return (
    <div>
      <h2>{detail.merchant_name ?? `가게 ${detail.merchant_id}`}</h2>
      <p className="admin-note">
        {detail.merchant_address ?? '주소 없음'} · 가게번호 {detail.merchant_id} · 제보자{' '}
        {detail.submitted_email ?? '비로그인'} · AI {detail.model ?? '-'}
      </p>
      {!pending && (
        <p className="admin-note">
          이미 {detail.status === 'approved' ? '승인' : '반려'}된 제보예요.
          {detail.review_note && ` 메모: ${detail.review_note}`}
        </p>
      )}

      {pending && (
        <div className="admin-photo">
          {photoUrls.length > 1 && (
            <div className="admin-photo-tabs" role="group" aria-label="메뉴판 사진 고르기">
              {photoUrls.map((url, index) => (
                <button
                  key={index}
                  type="button"
                  className={index === photoIndex ? 'on' : ''}
                  aria-pressed={index === photoIndex}
                  onClick={() => setPhotoIndex(index)}
                >
                  {url ? <img src={url} alt="" /> : null}
                  <span>사진 {index + 1}</span>
                </button>
              ))}
            </div>
          )}
          {photoUrls[photoIndex] ? (
            <a href={photoUrls[photoIndex] as string} target="_blank" rel="noreferrer">
              <img
                src={photoUrls[photoIndex] as string}
                alt={`제보된 메뉴판 사진${photoUrls.length > 1 ? ` ${photoIndex + 1}` : ''}`}
              />
            </a>
          ) : (
            <p className="admin-note">
              {photoError ?? (photoUrls.length ? '이 사진을 불러오지 못했어요.' : '사진을 불러오는 중…')}
            </p>
          )}
        </div>
      )}

      <table className="admin-items">
        <thead>
          <tr>
            <th>메뉴</th>
            <th>가격(원)</th>
            <th>분류</th>
            {pending && <th />}
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => {
            const problem = validateDraft(draft)
            return (
              <tr key={draft.key} className={draft.uncertain ? 'uncertain' : ''}>
                <td>
                  <input
                    value={draft.name}
                    disabled={!pending}
                    onChange={(e) => update(draft.key, { name: e.target.value })}
                  />
                  {draft.uncertain && <span className="tag">확인 필요</span>}
                  {photoUrls.length > 1 && draft.photo && (
                    <button type="button" className="photo-tag" onClick={() => setPhotoIndex(draft.photo! - 1)}>
                      사진 {draft.photo}
                    </button>
                  )}
                </td>
                <td>
                  <input
                    value={draft.price}
                    inputMode="numeric"
                    disabled={!pending}
                    onChange={(e) => update(draft.key, { price: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={draft.category}
                    disabled={!pending}
                    onChange={(e) => update(draft.key, { category: e.target.value as MenuCategory })}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c} disabled={c === 'unknown'}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </select>
                </td>
                {pending && (
                  <td>
                    <button onClick={() => setDrafts((cur) => cur.filter((d) => d.key !== draft.key))}>
                      삭제
                    </button>
                    {problem && <span className="admin-error"> {problem}</span>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {detail.rejected.length > 0 && (
        <details className="admin-note">
          <summary>AI가 걸러 낸 항목 {detail.rejected.length}개</summary>
          <ul>
            {detail.rejected.map((r, i) => (
              <li key={i}>
                {r.name} {r.price_text} — {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {pending && (
        <>
          <button onClick={() => setDrafts((cur) => [...cur, emptyDraft()])}>+ 메뉴 추가</button>

          <details className="admin-current" open={currentMenus.length > 0 && currentMenus.length <= 12}>
            <summary>지금 이 가게에 등록된 메뉴 {currentMenus.length}개</summary>
            {currentMenus.length === 0 ? (
              <p className="admin-note">아직 승인된 메뉴가 없어요.</p>
            ) : (
              <ul>
                {currentMenus.map((menu) => (
                  <li key={`${menu.name}-${menu.price_won}`}>
                    {menu.name} · {menu.price_won.toLocaleString('ko-KR')}원 · {categoryLabel(menu.category as MenuCategory)}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <fieldset className="admin-mode">
            <legend>승인 방식</legend>
            <label>
              <input type="radio" name={`mode-${id}`} checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span><strong>기존 메뉴에 추가</strong> — 이름이 같은 메뉴는 새 가격·분류로 바꾸고, 나머지 기존 메뉴는 그대로 둬요. (메뉴판이 여러 장일 때)</span>
            </label>
            <label>
              <input type="radio" name={`mode-${id}`} checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span><strong>통째로 교체</strong> — 기존 메뉴를 모두 지우고 위 목록만 남겨요. (메뉴판이 새로 바뀌었을 때)</span>
            </label>
          </fieldset>

          <p className="admin-note">
            {result &&
              (mode === 'merge'
                ? `승인하면 새 메뉴 ${result.added}개 추가, ${result.updated}개 가격·분류 갱신, 기존 ${result.kept}개 유지 → 총 ${result.items.length}개가 돼요.`
                : `승인하면 기존 메뉴 ${result.removed}개가 지워지고 ${result.items.length}개만 남아요.`)}
            {preview && ` (만원 이하 식사: ${preview === 'Y' ? '있음' : '없음'})`}
            {result && !preview && ' (식사 메뉴가 없어 만원 이하 여부는 "모름"으로 남아요)'}
          </p>
          <textarea
            className="admin-memo"
            placeholder="메모(선택)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && <p className="admin-error">{error}</p>}
          <div className="admin-actions">
            <button className="admin-primary" disabled={busy} onClick={() => act('approve')}>
              승인
            </button>
            <button className="admin-danger" disabled={busy} onClick={() => act('reject')}>
              반려
            </button>
          </div>
        </>
      )}
    </div>
  )
}
