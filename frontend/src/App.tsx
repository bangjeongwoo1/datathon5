import NearestVoice from './NearestVoice'
import { parseVoiceIntent } from './voiceIntent'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopeMerchants } from './mapClusters'
import KakaoMap from './KakaoMap'
import type { ReactNode } from 'react'
import VoiceSearch from './VoiceSearch'
import { filterMerchants } from './merchants'
import { loadRegionMerchants } from './merchantApi'
import type { Merchant } from './merchants'
import './App.css'
import './MerchantList.css'
import type { Coordinates } from './kakao'
import { useAuth } from './useAuth'
import ReviewPanel from './ReviewPanel'
import { fetchAllReviewSummaries, fetchAllTagCounts } from './reviewApi'
import type { ReviewSummary, TagCounts } from './reviewApi'
import type { ReviewTagCode } from './reviewTags'
import { straightDistanceMeters } from './merchantDistance'
import { requestCurrentLocation } from './userLocation'
function Icon({name,size=20}:{name:string;size?:number}) {
 const paths:Record<string,ReactNode>={search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="m4 10 16-6-6 16-3-7-7-3Z"/><path d="m11 13 9-9"/></>,phone:<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 5-4 5-7 3C7 17 3 12 3 7c0-3 2-4 4-4Z"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,reset:<><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></>,target:<><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,leaf:<><path d="M20 3C8 1 2 7 5 15c8 5 16-1 15-12Z"/><path d="M3 21 15 9"/></>,chevron:<path d="m7 10 5 5 5-5"/>,user:<><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 5-5.5 7-5.5S17.5 16 19 20"/></>}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.pin}</svg>
}

const color=(c:string)=>c==='편의점'?'green':c==='베이커리/간식'?'orange':c==='마트'?'purple':'blue'

type SortMode = 'rating' | 'distance' | ReviewTagCode

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'rating', label: '별점 높은 순' },
  { value: 'price', label: '가격이 좋다는 평가 많은 순' },
  { value: 'taste', label: '음식이 맛있다는 평가 많은 순' },
  { value: 'kindness', label: '친절하다는 평가 많은 순' },
  { value: 'atmosphere', label: '분위기가 좋다는 평가 많은 순' },
  { value: 'portion', label: '양이 넉넉하다는 평가 많은 순' },
  { value: 'distance', label: '내 위치와 가까운 순' },
]

function compareByMode(
  mode: SortMode,
  reviewSummaries: Record<string, ReviewSummary>,
  tagCountsAll: Record<string, TagCounts>,
  userLocation: Coordinates | null,
) {
  return (a: Merchant, b: Merchant) => {
    if (mode === 'rating') {
      const ra = (a.merchantId ? reviewSummaries[a.merchantId]?.avgRating : null) ?? -Infinity
      const rb = (b.merchantId ? reviewSummaries[b.merchantId]?.avgRating : null) ?? -Infinity
      return rb - ra
    }
    if (mode === 'distance') {
      const da = userLocation && a.coordinates ? straightDistanceMeters(userLocation, a.coordinates) : Infinity
      const db = userLocation && b.coordinates ? straightDistanceMeters(userLocation, b.coordinates) : Infinity
      return da - db
    }
    const pa = (a.merchantId ? tagCountsAll[a.merchantId]?.[mode].positive : null) ?? 0
    const pb = (b.merchantId ? tagCountsAll[b.merchantId]?.[mode].positive : null) ?? 0
    return pb - pa
  }
}

function App(){

  const regions = ['춘천시', '원주시', '강릉시', '홍천군'] as const
  type Region = (typeof regions)[number]

  const [region, setRegion] = useState<Region>('춘천시')


  const [merchants, setMerchants] = useState<Merchant[]>([])
  const [merchantLoadState, setMerchantLoadState] =
    useState<'loading' | 'ready' | 'error'>('loading')
    const [reloadRequest, setReloadRequest] = useState(0)

  useEffect(() => {
    const controller = new AbortController()


    loadRegionMerchants(region, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return

        setMerchants(items)
        setMerchantLoadState('ready')
      })
      .catch((error) => {
        if (controller.signal.aborted) return

        console.error('가맹점 데이터 조회 오류:', error)
        setMerchantLoadState('error')
      })

    return () => controller.abort()
}, [region, reloadRequest])

 const [voiceSearchRequest, setVoiceSearchRequest] = useState(0)
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('전체')
 const [sortMode,setSortMode]=useState<SortMode>('rating')
 const [minReviewsOnly,setMinReviewsOnly]=useState(false)
 const [userLocation,setUserLocation]=useState<Coordinates|null>(null)

 const [selectionRequest,setSelectionRequest]=useState(0)
 const [selectedId, setSelectedId] = useState<number | null>(null)
const [regionOpen, setRegionOpen] = useState(false)
const [centerRequest] = useState(0)
 const [notice,setNotice]=useState(''),[policy,setPolicy]=useState<string|null>(null)
 const policyTrigger=useRef<HTMLButtonElement|null>(null)
 const closePolicy=()=>{setPolicy(null);policyTrigger.current?.focus()}
 const [clusterIds,setClusterIds]=useState<number[]|null>(null)
 const {user,sessionLoading,signingIn,authError,signInWithGoogle,signOut,clearAuthError}=useAuth()
 const [userMenuOpen,setUserMenuOpen]=useState(false)

const receiveLocation = useCallback((position: Coordinates) => {
  setUserLocation(position)
  setSortMode('distance')
  setClusterIds(null)
  setSelectedId(null)
}, [setUserLocation, setSortMode, setClusterIds, setSelectedId])

 const resultsHeading=useRef<HTMLDivElement>(null)
const filtered = useMemo(
  () => filterMerchants(merchants, {
    query: search,
    category,
  }),
  [merchants, search, category]
)
 const visible=useMemo(()=>scopeMerchants(filtered,clusterIds),[filtered,clusterIds])

 // 정렬(별점순/평가항목순)과 사이드바 평균 별점 표시에 쓸 리뷰 데이터를 지역 전체
 // 기준으로 한 번에 조회 (merchant_id 목록을 안 넘기므로 지역 크기와 무관하게 가벼움 -
 // 자세한 이유는 reviewApi.ts의 fetchAllReviewSummaries/fetchAllTagCounts 주석 참고).
 const [reviewSummaries, setReviewSummaries] = useState<Record<string, ReviewSummary>>({})
 const [tagCountsAll, setTagCountsAll] = useState<Record<string, TagCounts>>({})
 useEffect(() => {
   let active = true
   Promise.all([fetchAllReviewSummaries(), fetchAllTagCounts()])
     .then(([summaries, tagCounts]) => {
       if (!active) return
       setReviewSummaries(summaries)
       setTagCountsAll(tagCounts)
     })
     .catch(error => console.error('리뷰 집계 조회 오류:', error))
   return () => { active = false }
 }, [merchants])

 const sortedVisible = useMemo(() => {
   const base = minReviewsOnly
     ? visible.filter(s => (s.merchantId ? reviewSummaries[s.merchantId]?.reviewCount ?? 0 : 0) >= 10)
     : visible
   return [...base].sort(compareByMode(sortMode, reviewSummaries, tagCountsAll, userLocation))
 }, [visible, sortMode, minReviewsOnly, reviewSummaries, tagCountsAll, userLocation])


const selectStore = useCallback((id: number) => {
  setSelectedId(id)
  setClusterIds(ids => ids?.includes(id) ? ids : null)
}, [setSelectedId, setClusterIds])

const selectRegion = useCallback((ids: number[]) => {
  setClusterIds(ids)
  setSelectedId(null)
}, [setClusterIds, setSelectedId])

 useEffect(()=>{if(clusterIds!==null)resultsHeading.current?.focus()},[clusterIds])
 const clearRegion=()=>{setClusterIds(null);setSelectedId(null);requestAnimationFrame(()=>resultsHeading.current?.focus())}
 const selected=visible.find(s=>s.id===selectedId)
 const reset=()=>{setQuery('');setSearch('');setCategory('전체');setSortMode('rating');setMinReviewsOnly(false);setSelectedId(null);setClusterIds(null)}


const changeRegion = (nextRegion: Region) => {
  setMerchantLoadState('loading')
  setMerchants([])
  setRegion(nextRegion)
  setRegionOpen(false)
  reset()
}


 const route = (s: Merchant) =>
  window.open(
    `https://map.kakao.com/link/search/${encodeURIComponent(
      s.name + ' ' + region
    )}`,
    '_blank',
    'noopener,noreferrer'
  )
  const phone = (store: Merchant) => {
  const number = store.phone?.trim()

  if (!number) {
    setNotice('등록된 전화번호가 없습니다.')
    return
  }

  setNotice(`${store.name} 전화번호: ${number}`)
}

const handleSortChange = async (mode: SortMode) => {
  if (mode === 'distance' && !userLocation) {
    try {
      const location = await requestCurrentLocation()
      setUserLocation(location)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '현재 위치를 가져오지 못했습니다.')
      return
    }
  }
  setSortMode(mode)
}

 return <div className="portal">

  {merchantLoadState === 'loading' && (
    <p role="status" style={{ padding: '8px 20px' }}>
      가맹점 데이터를 불러오는 중입니다...
    </p>
  )}


{merchantLoadState === 'error' && (
  <div
    role="alert"
    style={{
      padding: '12px 20px',
      color: '#b91c1c',
    }}
  >
    <p>
      가맹점 데이터를 불러오지 못했습니다.
      백엔드 서버 연결을 확인해 주세요.
    </p>

    <button
      type="button"

onClick={() => {
  setMerchantLoadState('loading')
  setMerchants([])
  setReloadRequest(n => n + 1)
}}

      style={{
        marginTop: 8,
        padding: '8px 14px',
        background: '#2563eb',
        color: 'white',
        borderRadius: 6,
      }}
    >
      다시 시도
    </button>
  </div>
)}



<header className="header">
  <a className="brand" href="#finder" onClick={reset}>
    <span className="brand-icon">
      <img src="/eatda-logo.png" alt="잇다 로고" />
    </span>
    <strong>잇다(EATDA)</strong>
  </a>

  <nav>
    <a className="nav-active" href="#finder">
      가맹점 찾기
    </a>
    <a
      href="/mealcard.html"
      style={{
        marginLeft: 8,
        padding: '9px 18px',
        border: '1px solid #2563eb',
        borderRadius: 7,
        color: '#2563eb',
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      가맹 권유 지도
    </a>
  </nav>

  <div className="region-wrap">
    <button
      className="region-button"
      onClick={() => setRegionOpen(!regionOpen)}
      aria-expanded={regionOpen}
    >
      <Icon name="pin" size={17} />
      <span>
        지역 설정 <b>강원특별자치도 {region}</b>
      </span>
      <Icon name="chevron" size={16} />
    </button>

    {regionOpen && (
      <div className="region-menu">
        <strong>서비스 지역</strong>

        {regions.map((r) => (
          <button
            key={r}
            onClick={() => changeRegion(r)}
          >
            강원특별자치도 {r}
            {region === r && <span>✓</span>}
          </button>
        ))}

        <p>
          선택한 지역의 가맹점 정보를 제공합니다.
        </p>
      </div>
    )}
  </div>

  <div className="auth-wrap">
    {sessionLoading ? (
      <span className="auth-loading" aria-live="polite">
        확인 중…
      </span>
    ) : user ? (
      <div className="user-wrap">
        <button
          className="region-button"
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-expanded={userMenuOpen}
        >
          <Icon name="user" size={17} />
          <span>{user.user_metadata?.full_name || user.email}</span>
          <Icon name="chevron" size={16} />
        </button>

        {userMenuOpen && (
          <div className="region-menu">
            <strong>{user.user_metadata?.full_name || '로그인됨'}</strong>
            <p>{user.email}</p>
            <button
              onClick={async () => {
                setUserMenuOpen(false)
                await signOut()
              }}
            >
              로그아웃
            </button>
          </div>
        )}
      </div>
    ) : (
      <button
        className="region-button"
        onClick={signInWithGoogle}
        disabled={signingIn}
        aria-busy={signingIn}
      >
        <Icon name="user" size={17} />
        <span>{signingIn ? '이동 중…' : 'Google로 로그인'}</span>
      </button>
    )}
  </div>
</header>

 <div className="announcement"><Icon name="info" size={17}/><strong>이용 안내</strong><p>배달 주문은 매장에 문의 후 이용하시기 바랍니다. <span>일부 가맹점은 포장 및 매장 식사만 지원됩니다.</span></p><span className="banner-tag">함께하는 따뜻한 한 끼</span></div>
 <main id="finder" className="split"><aside className="sidebar" aria-label="가맹점 검색 및 목록"><section className="search-section"><div className="eyebrow">우리 동네 든든한 한 끼</div><h1>어디서 먹을까요<span>?</span></h1><p className="intro">가까운 급식카드 가맹점을 찾아보세요.</p><form onSubmit={e=>{e.preventDefault();setSearch(query);setSelectedId(null);setClusterIds(null)}}><div className="search-input"><Icon name="search"/><input aria-label="가맹점 이름 또는 주소" placeholder="가맹점 이름, 주소로 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="search-submit" type="submit" aria-label="검색"><Icon name="search"/></button></div><div className="search-meta"><span><Icon name="pin" size={13}/> {region} 전체</span><button type="button" onClick={reset}><Icon name="reset" size={13}/> 초기화</button></div></form>
<VoiceSearch
  resultCount={sortedVisible.length}
  onRecognized={(text) => {
    const intent = parseVoiceIntent(text)

    setQuery(intent.query)
    setSearch(intent.query)
    setCategory(intent.category)

    if (userLocation) setSortMode('distance')

    setSelectedId(null)
    setClusterIds(null)

    // 음성 검색 완료 후 가까운 가맹점 자동 안내 요청
    setVoiceSearchRequest(n => n + 1)
  }}
/>

<NearestVoice
  stores={filtered}
  trigger={voiceSearchRequest}
/>

<div className="data-note"><Icon name="info" size={14}/><span>지자체 공공데이터 연계를 위한 <b>디자인 시안</b></span></div></section>
<div className="sort-bar">
  <select className="sort-select" aria-label="정렬 기준" value={sortMode} onChange={e=>void handleSortChange(e.target.value as SortMode)}>
    {SORT_OPTIONS.map(opt=><option key={opt.value} value={opt.value}>{opt.label}</option>)}
  </select>
  <label className="sort-min-reviews">
    <input type="checkbox" checked={minReviewsOnly} onChange={e=>setMinReviewsOnly(e.target.checked)}/>
    리뷰 10개 미만 제외
  </label>
</div>
 {clusterIds!==null&&<div className="cluster-selection"><span><Icon name="pin" size={14}/>선택한 묶음의 가맹점 {visible.length}곳</span><button onClick={clearRegion}>전체 목록 보기 ×</button></div>}
 <div className="store-list" aria-live="polite">{!sortedVisible.length?<div className="empty"><Icon name="search" size={32}/><h3>검색 결과가 없습니다</h3><p>검색어나 필터를 변경해 보세요.</p><button onClick={reset}>필터 초기화</button></div>:sortedVisible.map(s=><article key={s.id} className={`store-card ${selectedId===s.id?'selected':''}`}><div className="store-top"><span className={`category-label ${color(s.category)}`}>{s.category}</span><span className="status closed">
  영업 여부 미확인
</span></div><button className="store-title" aria-pressed={selectedId===s.id} onClick={()=>{setSelectedId(s.id);setSelectionRequest(n=>n+1)}}>{s.name}<span>›</span></button>{s.merchantId && reviewSummaries[s.merchantId] && (reviewSummaries[s.merchantId].reviewCount>0?<span className="store-rating">★ {reviewSummaries[s.merchantId].avgRating?.toFixed(1)}</span>:<span className="store-rating none">평가 없음</span>)}<p className="store-address">{s.address}</p><div className="store-details">
  {s.phone && <span>{s.phone}</span>}
</div><div className="menu-tags"><span className="meal-tag">방문 전 카드 사용 여부 확인</span>{s.menu?.map(m=><span key={m}>{m}</span>)}</div><div className="store-actions"><button onClick={()=>route(s)}><Icon name="arrow" size={15}/> 길찾기 ↗</button><button onClick={() => phone(s)}>
  <Icon name="phone" size={14}/> 전화 안내
</button>{s.delivery&&<span className="delivery-tag">배달 가능</span>}</div></article>)}</div><div className="sidebar-bottom"><Icon name="info" size={13}/> 매장·거리·가격·영업 상태는 모두 예시 정보입니다.</div></aside>
 <section className="map" aria-label="춘천 중심부 카카오 지도"><KakaoMap stores={filtered} region={region} selectedId={selected?.id??null} onSelect={selectStore} onClusterSelect={selectRegion} centerRequest={centerRequest} selectionRequest={selectionRequest} onLocationChange={receiveLocation} userLocation={userLocation}/>
 {selected&&<div className="map-popup"><div className="popup-head"><span className="popup-kicker">
  선택한 가맹점 <span>공공데이터 기반</span>
</span><button aria-label="매장 상세 닫기" onClick={()=>setSelectedId(null)}>×</button></div><div className="popup-title"><span className="popup-icon"><Icon name="pin" size={23}/></span><div><h2>{selected.name}</h2><p>{selected.category} <span>·</span> <b>영업 여부 미확인</b></p></div></div><div className="popup-info"><p><Icon name="pin" size={16}/>{selected.address}</p>{selected.phone && (
  <p>
    <Icon name="phone" size={16}/>
    {selected.phone}
  </p>
)}</div><div className="popup-meal"><span>든든한 한 끼 추천</span><strong>{selected.menu?.join(' · ') ?? ''}</strong></div><div className="popup-actions"><button onClick={()=>route(selected)}><Icon name="arrow" size={17}/>길찾기 ↗</button><button onClick={() => phone(selected)}>
  <Icon name="phone" size={16}/>전화 안내
</button></div><ReviewPanel key={selected.merchantId??selected.id} merchantId={selected.merchantId} merchantName={selected.name}/><p className="popup-footnote">방문 전 실제 가맹 여부와 이용 가능 메뉴를 확인해 주세요.</p></div>}
 <div className="map-legend"><strong>가맹점 유형</strong><span><i className="blue"/>일반음식점</span><span><i className="green"/>편의점</span><span><i className="orange"/>베이커리/간식</span><span><i className="purple"/>마트</span></div></section></main>
 <footer className="footer"><div className="footer-brand"><img className="footer-logo" src="/eatda-logo.png" alt="잇다 로고"/><div><strong>아동급식카드 종합지원센터</strong><p>아이들의 건강한 오늘, 함께 만드는 따뜻한 내일</p></div></div><div className="footer-data">지자체 아동복지과 공공데이터 연계 안내<span>공공데이터 기반 정보이며, 최신 가맹 여부와 영업 상태는 방문 전 확인해 주세요.</span></div><div className="footer-support"><span>고객지원 문의 <strong>1544-3674</strong></span><div><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('이용약관')}}>이용약관</button><i/><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('개인정보처리방침')}}>개인정보처리방침</button></div></div></footer>
 {(notice||authError)&&<div className="toast" role="status"><Icon name="info" size={18}/>{notice||authError}<button aria-label="알림 닫기" onClick={()=>{setNotice('');clearAuthError()}}>×</button></div>}
 {policy&&<div className="modal-backdrop" onClick={closePolicy}><section className="policy-modal" role="dialog" aria-modal="true" aria-label={policy} onKeyDown={e=>{if(e.key==='Escape')closePolicy();if(e.key==='Tab')e.preventDefault()}} onClick={e=>e.stopPropagation()}><h2>{policy} · 시안 안내</h2><p>이 화면은 비공식 디자인 프로토타입입니다. 개인정보를 수집하거나 저장하지 않으며 검색과 필터는 브라우저 안에서 처리합니다. 길찾기는 외부 카카오맵 검색으로 연결됩니다.</p><p>실제 약관 및 개인정보처리방침은 운영기관의 공식 안내를 확인해 주세요.</p><button autoFocus onClick={closePolicy}>확인</button></section></div>}
 </div>
}
export default App





