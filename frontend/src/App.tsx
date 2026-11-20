import VoiceGuide from './VoiceGuide'
import type { VoiceStatus } from './VoiceGuide'
import { mealsWithinBudget } from './mealPrice'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopeMerchants } from './mapClusters'
import KakaoMap from './KakaoMap'
import type { ReactNode } from 'react'
import MenuUploadModal from './MenuUploadModal'
import { filterMerchants } from './merchants'
import { CUISINE_OPTIONS } from './cuisineFilter'
import type { CuisineType } from './cuisineFilter'
import { loadRegionMerchants } from './merchantApi'
import type { Merchant } from './merchants'
import './App.css'
import './MerchantList.css'
import './FinderDesign.css'
import type { Coordinates } from './kakao'
import { useAuth } from './useAuth'
import ReviewPanel from './ReviewPanel'
import { fetchAllReviewSummaries, fetchAllTagCounts } from './reviewApi'
import type { ReviewSummary, TagCounts } from './reviewApi'
import type { ReviewTagCode } from './reviewTags'
import { straightDistanceMeters } from './merchantDistance'
import { requestCurrentLocation } from './userLocation'
import { matchedMenuNames, menuMatchLabel } from './menuSearch'
import { loadSidebarOpen, saveSidebarOpen } from './finderSidebar'
function Icon({name,size=20}:{name:string;size?:number}) {
 const paths:Record<string,ReactNode>={mic:<><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,map:<><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16m6-14v16"/></>,list:<><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="m4 10 16-6-6 16-3-7-7-3Z"/><path d="m11 13 9-9"/></>,phone:<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 5-4 5-7 3C7 17 3 12 3 7c0-3 2-4 4-4Z"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,reset:<><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></>,target:<><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,leaf:<><path d="M20 3C8 1 2 7 5 15c8 5 16-1 15-12Z"/><path d="M3 21 15 9"/></>,chevron:<path d="m7 10 5 5 5-5"/>,user:<><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-4 5-5.5 7-5.5S17.5 16 19 20"/></>}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.pin}</svg>
}

const color=(c:string)=>c==='편의점'?'green':c==='베이커리/간식'?'orange':c==='마트'?'purple':'blue'

type SortMode = 'rating' | 'distance' | ReviewTagCode

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'rating', label: '별점 높은 순' },
  { value: 'price', label: '가격이 좋다는 평가 많은 순' },
  { value: 'taste', label: '음식이 맛있다는 평가 많은 순' },
  { value: 'portion', label: '양이 넉넉하다는 평가 많은 순' },
  { value: 'kindness', label: '친절하다는 평가 많은 순' },
  { value: 'atmosphere', label: '분위기가 좋다는 평가 많은 순' },
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
    // 순긍정(긍정 개수 - 부정 개수) 기준. 긍정 개수만 보면 부정도 같이 많이 받은
    // 가게가 실제로는 평가가 더 안 좋은데도 위로 올라가는 문제가 있어서 순점수로 비교.
    // 단, 순긍정이 마이너스라도 "리뷰가 아예 없는 가게"보다는 위에 와야 하므로
    // 리뷰 존재 여부(reviewSummaries)로 먼저 구분하고, 리뷰가 없으면 -Infinity로 제일 아래로.
    const hasReviewsA = a.merchantId ? (reviewSummaries[a.merchantId]?.reviewCount ?? 0) > 0 : false
    const hasReviewsB = b.merchantId ? (reviewSummaries[b.merchantId]?.reviewCount ?? 0) > 0 : false
    const countA = a.merchantId ? tagCountsAll[a.merchantId]?.[mode] : null
    const countB = b.merchantId ? tagCountsAll[b.merchantId]?.[mode] : null
    const netA = hasReviewsA ? (countA ? countA.positive - countA.negative : 0) : -Infinity
    const netB = hasReviewsB ? (countB ? countB.positive - countB.negative : 0) : -Infinity
    return netB - netA
  }
}

function App(){

  const regions = ['춘천시', '원주시', '강릉시', '홍천군'] as const
  type Region = (typeof regions)[number]

  const [region, setRegion] = useState<Region>('춘천시')
  const [mobileView, setMobileView] = useState<'map' | 'list'>('list')
 // 데스크톱에서 왼쪽 목록을 접었는지(마지막 상태를 기억한다). 모바일은 mobileView 로 따로 전환한다.
 const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen)
 const toggleSidebar = () => { const next = !sidebarOpen; setSidebarOpen(next); saveSidebarOpen(next) }
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({ enabled: false, message: '마이크 연결 중', heard: '', answer: '', error: '' })
  const [routeRequest, setRouteRequest] = useState(0)
  const [listLimit, setListLimit] = useState(24)
  const [maximumPrice, setMaximumPrice] = useState<number | null>(null)
  const openVoice = useCallback(() => setVoiceOpen(true), [])



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

 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('전체')
 const [cuisine, setCuisine] = useState<CuisineType | null>(null)
 const [sortMode,setSortMode]=useState<SortMode>('rating')
 const [minReviewsOnly,setMinReviewsOnly]=useState(false)
 const [underTenOnly,setUnderTenOnly]=useState(false)
 const [userLocation,setUserLocation]=useState<Coordinates|null>(null)

 const [selectionRequest,setSelectionRequest]=useState(0)
 const [selectedId, setSelectedId] = useState<number | null>(null)
 const [uploadStore, setUploadStore] = useState<Merchant | null>(null)
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
    cuisine,
    underTenOnly,
  }).filter(store => maximumPrice === null || mealsWithinBudget(store.confirmedMeals, maximumPrice).length > 0 || (store.minMealPriceWon !== undefined && store.minMealPriceWon <= maximumPrice)),
  [merchants, search, category, cuisine, underTenOnly, maximumPrice]
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
  setMobileView('map')
  setClusterIds(ids => ids?.includes(id) ? ids : null)
}, [setSelectedId, setClusterIds])

const selectRegion = useCallback((ids: number[]) => {
  setClusterIds(ids)
  setSidebarOpen(true) // 고른 묶음이 목록에 나오므로 접혀 있으면 펼친다(저장된 선택은 바꾸지 않는다)
  setSelectedId(null)
  setMobileView('list')
}, [setClusterIds, setSelectedId])

 useEffect(()=>{if(clusterIds!==null)resultsHeading.current?.focus()},[clusterIds])
 const clearRegion=()=>{setClusterIds(null);setSelectedId(null);requestAnimationFrame(()=>resultsHeading.current?.focus())}
 const selected=merchants.find(s=>s.id===selectedId)
 const reset=()=>{setQuery('');setSearch('');setCategory('전체');setCuisine(null);setSortMode('rating');setMinReviewsOnly(false);setUnderTenOnly(false);setMaximumPrice(null);setSelectedId(null);setClusterIds(null)}


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

 useEffect(() => { setListLimit(24) }, [search, category, cuisine, maximumPrice, region, clusterIds, sortMode, minReviewsOnly])
 useEffect(() => {
   if (!voiceOpen) return
   const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setVoiceOpen(false) }
   window.addEventListener('keydown', close)
   return () => window.removeEventListener('keydown', close)
 }, [voiceOpen])
 const cheapest = (store: Merchant) => mealsWithinBudget(store.confirmedMeals, maximumPrice).sort((a,b) => a.price-b.price)[0]
 const categories = ['전체', '일반음식점', '편의점', '베이커리/간식', '마트', '미분류']
 const categoryNames: Record<string,string> = { 전체: '전체', 일반음식점: '식당', 편의점: '편의점', '베이커리/간식': '빵·간식', 마트: '마트', 미분류: '미분류' }
 const showVoice = () => setVoiceOpen(value => !value)

 const applyBudget = (price: number | null) => {
   setMaximumPrice(price)
   setUnderTenOnly(price === 10000)
   setClusterIds(null)
   setSelectedId(null)
 }
 return <div className="portal finder-design">
   <a className="voice-skip-link" href="#voice-panel" onClick={openVoice}>음성 상담으로 바로 가기</a>
   <header className="header">
     <a className="brand" href="#finder" onClick={reset}>
       <span className="brand-icon"><img src="/eatda-logo.png" alt="" /></span>
       <strong>잇다</strong>
     </a>
     <nav className="desktop-links" aria-label="주요 메뉴">
       <a href="/">홈</a>
       <a className="nav-active" href="#finder" onClick={() => setMobileView('map')}>지도</a>
       <a href="#finder" onClick={() => setMobileView('list')}>가맹점 목록</a>
       <a href="/mealcard.html">가맹 권유 지도 <span aria-hidden="true">↗</span></a>
     </nav>
     <div className="region-wrap">
       <button className="region-button" onClick={() => setRegionOpen(!regionOpen)} aria-expanded={regionOpen}>
         <Icon name="pin" size={17}/><span><b>{region}</b></span><Icon name="chevron" size={14}/>
       </button>
       {regionOpen && <div className="region-menu"><strong>어느 지역에서 찾을까요?</strong>
         {regions.map(r => <button key={r} onClick={() => changeRegion(r)} aria-pressed={region === r}>{r}{region === r && <span>✓</span>}</button>)}
         <p>강원특별자치도 가맹점 안내</p>
       </div>}
     </div>
     <button className="header-voice" onClick={showVoice} aria-expanded={voiceOpen} aria-controls="voice-panel"><Icon name="mic" size={17}/>잇다와 말하기</button>
     <div className="auth-wrap">{sessionLoading ? <span className="auth-loading">확인 중…</span> : user ?
       <div className="user-wrap"><button className="account-button" aria-label="내 계정" onClick={() => setUserMenuOpen(!userMenuOpen)} aria-expanded={userMenuOpen}><Icon name="user" size={20}/></button>
         {userMenuOpen && <div className="region-menu"><strong>{user.user_metadata?.full_name || '로그인됨'}</strong><p>{user.email}</p><button onClick={async () => { setUserMenuOpen(false); await signOut() }}>로그아웃</button></div>}
       </div> : <button className="account-button" onClick={signInWithGoogle} disabled={signingIn} aria-label="Google로 로그인" title="Google로 로그인"><Icon name="user" size={20}/></button>}
     </div>
   </header>
   <main id="finder" className="split" data-view={mobileView} data-sidebar={sidebarOpen ? 'open' : 'closed'}>
     <aside id="finder-sidebar" className="sidebar" aria-label="가맹점 검색 및 목록">
       <section className="search-section">
         <h1 className="finder-sr-only">{region} 아동급식카드 가맹점 찾기</h1>
         <form onSubmit={e => { e.preventDefault(); setSearch(query); setSelectedId(null); setClusterIds(null); setMobileView('list'); setSidebarOpen(true) }}>
           <div className="search-input"><span className="figma-search-icon"><img src="/figma/search.svg" alt=""/></span><input aria-label="가맹점 이름, 메뉴 또는 주소" placeholder="가게 이름, 메뉴, 주소로 검색해 보세요" value={query} onChange={e => setQuery(e.target.value)}/><button className="search-submit" type="submit" aria-label="검색"><Icon name="arrow" size={20}/></button></div>
         </form>
         <div className="finder-categories" role="group" aria-label="가맹점 종류">{categories.map(c => <button key={c} className={category === c && !cuisine ? 'active' : ''} aria-pressed={category === c && !cuisine} onClick={() => { setCategory(c); setCuisine(null); setQuery(''); setSearch(''); setSelectedId(null); setClusterIds(null) }}>{categoryNames[c]}</button>)}</div>
         <div className="finder-cuisine-row" role="group" aria-label="음식 종류">
           <span>음식 종류 <small>등록 업종 기준</small></span>
           <div className="finder-categories">{CUISINE_OPTIONS.map(type => <button key={type} type="button" className={cuisine === type ? 'active' : ''} aria-pressed={cuisine === type} onClick={() => { setCuisine(current => current === type ? null : type); setCategory('전체'); setQuery(''); setSearch(''); setSelectedId(null); setClusterIds(null) }}>{type}</button>)}</div>
         </div>
         <div className="budget-row"><button className={maximumPrice === 10000 ? 'budget-shortcut active' : 'budget-shortcut'} aria-pressed={maximumPrice === 10000} onClick={() => { applyBudget(maximumPrice === 10000 ? null : 10000); setSelectedId(null); setClusterIds(null) }}><Icon name="leaf" size={15}/>만 원 이하</button><label className="budget-input"><input aria-label="식사 가격 상한 (원)" type="number" min={1} max={1000000} step={1} placeholder="직접 입력" value={maximumPrice ?? ''} onChange={e => { const amount=e.currentTarget.valueAsNumber; if(Number.isFinite(amount)&&(!Number.isInteger(amount)||amount<1||amount>1000000))return;applyBudget(Number.isFinite(amount)?amount:null);setSelectedId(null);setClusterIds(null) }}/><span>원 이하</span></label><button className="reset-filters" aria-label="검색 조건 초기화" title="초기화" onClick={reset}><Icon name="reset" size={16}/></button></div>
         {maximumPrice !== null && <p className="price-note">관리자가 승인한 식사 가격 기준입니다. 방문 전 가격을 확인해 주세요.</p>}
       </section>
       <div className="results-heading" ref={resultsHeading} tabIndex={-1}><div><span>가맹점</span><b>{merchantLoadState === 'ready' ? sortedVisible.length.toLocaleString() : '…'}</b><small>곳</small></div><div className="results-tools"><select className="sort-select" aria-label="정렬 기준" value={sortMode} onChange={event => void handleSortChange(event.target.value as SortMode)}>{SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><button className="close-list" aria-label="목록 닫기" onClick={() => setMobileView('map')}>×</button></div></div>
       <label className="finder-review-filter"><input type="checkbox" checked={minReviewsOnly} onChange={event => setMinReviewsOnly(event.target.checked)}/>리뷰 10개 미만 제외</label>
       {clusterIds !== null && <div className="cluster-selection"><span>선택한 지도 영역</span><button onClick={clearRegion}>전체 보기 ×</button></div>}
       {merchantLoadState === 'loading' && <div className="merchant-state" role="status"><span className="loading-dot"/>가맹점 정보를 불러오고 있어요.</div>}
       {merchantLoadState === 'error' && <div className="merchant-state" role="alert"><p>가맹점 정보를 불러오지 못했어요.</p><button onClick={() => { setMerchantLoadState('loading'); setMerchants([]); setReloadRequest(n => n+1) }}>다시 불러오기</button></div>}
       <div className="store-list" aria-live="polite">{merchantLoadState === 'ready' && (!sortedVisible.length ? <div className="empty"><Icon name="search" size={30}/><h3>조건에 맞는 가맹점이 없어요</h3><p>검색어나 가격 조건을 바꿔 보세요.</p><button onClick={reset}>전체 가맹점 보기</button></div> : sortedVisible.slice(0,listLimit).map(store => { const meal=cheapest(store);return <article key={store.id} className={`store-card ${selectedId===store.id ? 'selected' : ''}`}>
         <div className="store-order" aria-hidden="true">{sortedVisible.indexOf(store)+1}</div>
         <div className="store-card-body"><div className="store-top"><span className={`category-label ${color(store.category)}`}>{categoryNames[store.category] || store.category}</span><span className="status closed">영업 미확인</span>{(() => { const label = menuMatchLabel(matchedMenuNames(store, search)); return label ? <span className="menu-match-badge" title={matchedMenuNames(store, search).join(', ')}>{label}</span> : null })()}</div>
           <button className="store-title" aria-pressed={selectedId===store.id} onClick={() => { setSelectedId(store.id); setSelectionRequest(n => n+1); setMobileView('map') }}>{store.name}<span aria-hidden="true">↗</span></button>
           {store.merchantId && reviewSummaries[store.merchantId] && <span className="store-rating">{reviewSummaries[store.merchantId].reviewCount > 0 ? `★ ${reviewSummaries[store.merchantId].avgRating?.toFixed(1)} · ${reviewSummaries[store.merchantId].reviewCount}개 평가` : '평가 없음'}</span>}<p className="store-address">{store.address}</p>{cuisine && <p className="cuisine-match-reason">세부 업종: {store.naverCuisine || store.detailCategory || store.rawCategory}</p>}{store.under10000 === 'Y' && <span className="under-ten-badge">만원 이하 식사 있음</span>}
           <p className={meal ? 'store-price' : 'store-price unconfirmed'}>{meal ? <>{meal.name}<strong>{meal.price.toLocaleString()}<small>원</small></strong>{meal.preview && <em>후보 가격</em>}</> : store.minMealPriceWon !== undefined ? `승인된 식사 최저 ${store.minMealPriceWon.toLocaleString()}원` : '메뉴·가격 확인 필요'}</p>
           <div className="store-actions"><button onClick={() => route(store)}><Icon name="arrow" size={14}/>길찾기</button><button onClick={() => phone(store)}><Icon name="phone" size={14}/>전화</button></div>
         </div></article> }))}
         {sortedVisible.length > listLimit && <button className="list-load-more" onClick={() => setListLimit(n => n+24)}>가맹점 더 보기 <span>＋</span></button>}
       </div>
       <p className="sidebar-bottom"><Icon name="info" size={13}/>방문 전 카드 사용 여부와 메뉴 가격을 확인해 주세요.</p>
     </aside>
     <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={sidebarOpen} aria-controls="finder-sidebar" aria-label={sidebarOpen ? '가맹점 목록 접기' : '가맹점 목록 펼치기'} title={sidebarOpen ? '목록 접기' : '목록 펼치기'}><span aria-hidden="true">{sidebarOpen ? '‹' : '›'}</span></button>
     <section className="map" aria-label={`${region} 카카오 가맹점 지도`}>
       <KakaoMap stores={filtered} region={region} selectedId={selected?.id??null} onSelect={selectStore} onClusterSelect={selectRegion} centerRequest={centerRequest} selectionRequest={selectionRequest} onLocationChange={receiveLocation} userLocation={userLocation}/>
       <button className="map-list-button" onClick={() => setMobileView(mobileView === 'list' ? 'map' : 'list')}><Icon name="list" size={17}/>{mobileView === 'list' ? '목록 닫기' : '목록 보기'} <b>{merchantLoadState === 'ready' ? sortedVisible.length.toLocaleString() : '…'}</b></button>
       {selected && <div className="map-popup"><div className="sheet-handle"/><div className="popup-head"><span className="popup-kicker">선택한 가맹점</span><button aria-label="매장 상세 닫기" onClick={() => setSelectedId(null)}>×</button></div>
         <div className="popup-title"><span className={`popup-icon ${color(selected.category)}`}><Icon name="pin" size={27}/></span><div><p>{selected.category}</p><h2>{selected.name}</h2></div></div>
         <div className="popup-info"><p><Icon name="pin" size={15}/>{selected.address}</p>{selected.phone && <p><Icon name="phone" size={15}/>{selected.phone}</p>}</div>
         <div className="finder-store-meta">
           {selected.naverCuisine && <p>세부 업종 · {selected.naverCuisine}</p>}
           {selected.businessHours?.weekday && <p>평일 · {selected.businessHours.weekday}</p>}
           {selected.businessHours?.saturday && <p>토요일 · {selected.businessHours.saturday}</p>}
           {selected.businessHours?.holiday && <p>공휴일 · {selected.businessHours.holiday}</p>}
           {selected.under10000 === 'Y' && <span className="under-ten-badge">만원 이하 식사 있음</span>}
         </div>
         <div className="selected-meals">{selected.confirmedMeals?.length ? selected.confirmedMeals.map(meal => <div key={`${meal.name}-${meal.price}`}><span>{meal.name}{meal.preview && <small>후보 가격</small>}</span><strong>{meal.price.toLocaleString()}원</strong></div>) : <p>메뉴·가격은 방문 전 확인해 주세요.</p>}</div>
         <div className="popup-actions"><button onClick={() => { setVoiceOpen(true); setRouteRequest(n => n+1) }}><Icon name="arrow" size={17}/>여기로 도보 안내</button><button onClick={() => route(selected)} aria-label="카카오맵 길찾기">카카오맵 ↗</button></div>
         <div className="finder-secondary-actions"><button onClick={() => phone(selected)}><Icon name="phone" size={15}/>전화번호 확인</button>{selected.merchantId && <button onClick={() => setUploadStore(selected)}>메뉴판 사진 올리기</button>}</div>
         <ReviewPanel key={selected.merchantId ?? selected.id} merchantId={selected.merchantId} merchantName={selected.name}/>
         <p className="popup-footnote">실제 카드 사용 여부와 영업 상태는 매장에 확인해 주세요.</p>
       </div>}
     </section>
   </main>
   <footer className="footer"><span><strong>잇다</strong> · 강원특별자치도 아동급식카드 가맹점 안내</span><div><button onClick={e => { policyTrigger.current=e.currentTarget;setPolicy('이용 안내') }}>이용 안내</button><button onClick={e => { policyTrigger.current=e.currentTarget;setPolicy('개인정보 안내') }}>개인정보 안내</button><a href="/mealcard.html">가맹 권유 지도 ↗</a></div></footer>
   <section className="voice-live-status" aria-label="실시간 음성 안내" data-enabled={voiceStatus.enabled}>
     <div className="voice-live-heading"><span className="voice-live-dot" aria-hidden="true"/><strong>{voiceStatus.message}</strong></div>
     <p>“잇다야, 근처 식당 찾아줘”라고 말하세요.</p><div className="voice-live-controls"><button onClick={() => document.getElementById('voice-mode-start')?.click()}>{voiceStatus.enabled ? '마이크 끄기' : '음성 준비'}</button><button onClick={openVoice}>상담 열기</button></div>
     <div role="status" aria-live="polite" aria-atomic="true">{voiceStatus.heard && <p className="voice-live-heard">들은 말 · {voiceStatus.heard}</p>}{voiceStatus.answer && <p className="voice-live-answer">잇다 · {voiceStatus.answer}</p>}{voiceStatus.error && <p className="voice-live-error">{voiceStatus.error}</p>}</div>
   </section>
   <div className={`voice-panel ${voiceOpen ? 'is-open' : ''}`} id="voice-panel" role="region" aria-label="잇다 음성 상담" inert={!voiceOpen}>
     <div className="voice-panel-heading"><span className="voice-avatar"><img src="/eatda-logo.png" alt=""/></span><div><h2>잇다와 말하기</h2><p>가맹점 찾기부터 길 안내까지</p></div><button onClick={() => setVoiceOpen(false)} aria-label="음성 상담 패널 닫기">×</button></div>
     <div className="voice-panel-body"><VoiceGuide onStatus={setVoiceStatus} key={region} dataReady={merchantLoadState==='ready'} stores={merchants} selected={selected} maximumPrice={maximumPrice} onActivity={openVoice} routeRequest={routeRequest} onBudgetSearch={applyBudget} onSelect={store => {setQuery('');setSearch('');setCategory('전체');setCuisine(null);setClusterIds(null);setSelectedId(store.id);setSelectionRequest(value=>value+1);setMobileView('map')}}/></div>
   </div>
   <nav className="mobile-bottom-nav" aria-label="화면 전환"><button aria-label="가맹점 찾기" aria-current={!voiceOpen&&mobileView==='list' ? 'page' : undefined} onClick={() => {setMobileView('list');setVoiceOpen(false)}}><img src="/figma/nav-search.svg" alt=""/><span>찾기</span></button><button aria-label="지도 보기" aria-current={!voiceOpen&&mobileView==='map' ? 'page' : undefined} onClick={() => {setMobileView('map');setVoiceOpen(false)}}><Icon name="map" size={22}/><span>지도</span></button><button aria-label="잇다 음성 상담" aria-current={voiceOpen ? 'page' : undefined} onClick={showVoice}><img src="/figma/nav-chat.svg" alt=""/><span>잇다 음성</span></button></nav>
   {(notice||authError)&&<div className="toast" role="status"><Icon name="info" size={18}/>{notice||authError}<button aria-label="알림 닫기" onClick={()=>{setNotice('');clearAuthError()}}>×</button></div>}
   {uploadStore?.merchantId && <MenuUploadModal merchantId={uploadStore.merchantId} merchantName={uploadStore.name} onClose={() => setUploadStore(null)}/>}
   {policy&&<div className="modal-backdrop" onClick={closePolicy}><section className="policy-modal" role="dialog" aria-modal="true" aria-label={policy} onKeyDown={e=>{if(e.key==='Escape')closePolicy()}} onClick={e=>e.stopPropagation()}><h2>{policy}</h2><p>지자체 공공데이터에 기반한 가맹점 안내 서비스입니다. 가맹 여부, 이용 가능한 메뉴, 가격과 영업 상태는 방문 전 매장에 확인해 주세요.</p><p>음성 모드를 사용하면 마이크에서 감지한 말소리가 음성 인식 서버로 전송됩니다. 기기 및 브라우저에서 마이크 사용 권한을 관리할 수 있습니다.</p><button autoFocus onClick={closePolicy}>확인</button></section></div>}
 </div>
}
export default App
