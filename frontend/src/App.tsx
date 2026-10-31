import NearestVoice from './NearestVoice'
import { parseVoiceIntent } from './voiceIntent'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopeMerchants } from './mapClusters'
import { buildPersistedPositions, filterStoresInBounds } from './mapPositions'
import type { ViewportBounds } from './mapPositions'
const merchantPositions=buildPersistedPositions(merchants)
import KakaoMap from './KakaoMap'
import type { ReactNode } from 'react'
import VoiceSearch from './VoiceSearch'
import { filterMerchants, merchants } from './merchants'
import type { Merchant } from './merchants'
import './App.css'
import './MerchantList.css'
import { merchantPage, LIST_PAGE_SIZE } from './merchantPage'
import type { Coordinates } from './kakao'
import { withDistances, sortByDistance, formatStraightDistance } from './merchantDistance'
function Icon({name,size=20}:{name:string;size?:number}) {
 const paths:Record<string,ReactNode>={search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="m4 10 16-6-6 16-3-7-7-3Z"/><path d="m11 13 9-9"/></>,phone:<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 5-4 5-7 3C7 17 3 12 3 7c0-3 2-4 4-4Z"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,reset:<><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></>,target:<><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,leaf:<><path d="M20 3C8 1 2 7 5 15c8 5 16-1 15-12Z"/><path d="M3 21 15 9"/></>,chevron:<path d="m7 10 5 5 5-5"/>}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.pin}</svg>
}
const categories=['전체','한식','중식','일식','양식','제과점','편의점','마트']
const color=(c:string)=>c==='편의점'?'green':c==='베이커리/간식'?'orange':c==='마트'?'purple':'blue'
function App(){
 const [voiceSearchRequest, setVoiceSearchRequest] = useState(0)
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('전체')
 const [distance,setDistance]=useState(false)
 const [userLocation,setUserLocation]=useState<Coordinates|null>(null)
 const receiveLocation=useCallback((position:Coordinates)=>{setUserLocation(position);setDistance(true);setClusterIds(null);setSelectedId(null)},[])
 const [selectionRequest,setSelectionRequest]=useState(0)
 const [selectedId,setSelectedId]=useState<number|null>(null),[regionOpen,setRegionOpen]=useState(false),[centerRequest,setCenterRequest]=useState(0)
 const [policy,setPolicy]=useState<string|null>(null)
 const policyTrigger=useRef<HTMLButtonElement|null>(null)
 const closePolicy=()=>{setPolicy(null);policyTrigger.current?.focus()}
 const [clusterIds,setClusterIds]=useState<number[]|null>(null)
 const resultsHeading=useRef<HTMLDivElement>(null)
 const [viewport,setViewport]=useState<ViewportBounds|null>(null)
 const lastViewport=useRef<ViewportBounds|null>(null)
 const receiveViewport=useCallback((bounds:ViewportBounds)=>{const previous=lastViewport.current;if(previous&&previous.south===bounds.south&&previous.north===bounds.north&&previous.west===bounds.west&&previous.east===bounds.east)return;lastViewport.current=bounds;setViewport(bounds);setClusterIds(null)},[])
 const filtered=useMemo(()=>{const measured=withDistances(filterMerchants(merchants,{query:search,category}),userLocation);return distance&&userLocation?sortByDistance(measured):measured},[search,category,distance,userLocation])
 const inViewport=useMemo(()=>viewport?filterStoresInBounds(filtered,merchantPositions,viewport):[],[filtered,viewport])
 const visible=useMemo(()=>scopeMerchants(inViewport,clusterIds),[inViewport,clusterIds])
 const [listPage,setListPage]=useState<{results:typeof visible|null;limit:number}>({results:null,limit:LIST_PAGE_SIZE})
 const listLimit=listPage.results===visible?listPage.limit:LIST_PAGE_SIZE
 const displayed=useMemo(()=>merchantPage(visible,listLimit,selectedId),[visible,listLimit,selectedId])
 const listRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{listRef.current?.scrollTo({top:0})},[visible])
 const selectStore=useCallback((id:number)=>{setSelectedId(id);setClusterIds(ids=>ids?.includes(id)?ids:null)},[])
 const selectRegion=useCallback((ids:number[])=>{setClusterIds(ids);setSelectedId(null)},[])
 useEffect(()=>{if(clusterIds!==null)resultsHeading.current?.focus()},[clusterIds])
 const clearRegion=()=>{setClusterIds(null);setSelectedId(null);requestAnimationFrame(()=>resultsHeading.current?.focus())}
 const selected=filtered.find(s=>s.id===selectedId)
 const reset=()=>{setQuery('');setSearch('');setCategory('전체');setDistance(Boolean(userLocation));setSelectedId(null);setClusterIds(null)}
 const route=(s:Merchant)=>window.open(`https://map.kakao.com/link/search/${encodeURIComponent(s.name+' 춘천')}`,'_blank','noopener,noreferrer')

 return <div className="portal">
 <header className="header"><a className="brand" href="#finder" onClick={reset}><span className="brand-icon"><img src="/eatda-logo.png" alt="잇다 로고"/></span><strong>잇다(EATDA)</strong></a><nav><a className="nav-active" href="#finder">가맹점 찾기</a><a href="/mealcard.html" style={{marginLeft:8,padding:'9px 18px',border:'1px solid #2563eb',borderRadius:7,color:'#2563eb',fontSize:13,fontWeight:700,whiteSpace:'nowrap'}}>가맹 권유 지도</a></nav><div className="region-wrap"><button className="region-button" onClick={()=>setRegionOpen(!regionOpen)} aria-expanded={regionOpen}><Icon name="pin" size={17}/><span>지역 설정 <b>강원도 춘천시</b></span><Icon name="chevron" size={16}/></button>{regionOpen&&<div className="region-menu"><strong>서비스 지역</strong><button onClick={()=>{setRegionOpen(false);reset();setCenterRequest(n=>n+1)}}>강원특별자치도 춘천시 <span>✓</span></button><p>춘천시 아동급식카드 가맹점 정보를 제공합니다.</p></div>}</div></header>
 <div className="announcement"><Icon name="info" size={17}/><strong>이용 안내</strong><p>배달 주문은 매장에 문의 후 이용하시기 바랍니다. <span>일부 가맹점은 포장 및 매장 식사만 지원됩니다.</span></p><span className="banner-tag">함께하는 따뜻한 한 끼</span></div>
 <main id="finder" className="split"><aside className="sidebar" aria-label="가맹점 검색 및 목록"><section className="search-section"><div className="eyebrow">우리 동네 든든한 한 끼</div><h1>어디서 먹을까요<span>?</span></h1><p className="intro">가까운 급식카드 가맹점을 찾아보세요.</p><form onSubmit={e=>{e.preventDefault();setSearch(query);setSelectedId(null);setClusterIds(null)}}><div className="search-input"><Icon name="search"/><input aria-label="가맹점 이름 또는 주소" placeholder="가맹점 이름, 주소로 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="search-submit" type="submit" aria-label="검색"><Icon name="search"/></button></div><div className="search-meta"><span><Icon name="pin" size={13}/> 현재 지도 범위</span><button type="button" onClick={reset}><Icon name="reset" size={13}/> 초기화</button></div></form>
<VoiceSearch
  resultCount={visible.length}
  onRecognized={(text) => {
    const intent = parseVoiceIntent(text)

    setQuery(intent.query)
    setSearch(intent.query)
    setCategory(categories[intent.categoryIndex])

    setDistance(Boolean(userLocation))

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

<div className="data-note"><Icon name="info" size={14}/><span>춘천시 아동급식카드 가맹점 공공데이터 기반</span></div></section>
 <section className="filter-section" aria-label="검색 필터"><div className="chips">{categories.map(c=><button key={c} className={category===c?'chip active':'chip'} aria-pressed={category===c} onClick={()=>{setCategory(c);setClusterIds(null);setSelectedId(null)}}>{c}</button>)}</div></section><div className="results-heading" ref={resultsHeading} tabIndex={-1}><span>{clusterIds===null?'지도 내 가맹점':'선택 지역 가맹점'} <b>{visible.length}</b><small>곳</small></span>{userLocation&&<button onClick={()=>setDistance(!distance)} aria-pressed={distance}>↕ {distance?'가까운순 (내 위치)':'기본순'} <Icon name="chevron" size={13}/></button>}</div>
 {clusterIds!==null&&<div className="cluster-selection"><span><Icon name="pin" size={14}/>선택한 묶음의 가맹점 {visible.length}곳</span><button onClick={clearRegion}>지도 내 목록 보기 ×</button></div>}
 <div className="store-list" ref={listRef} aria-live="polite">{!visible.length?<div className="empty"><Icon name="search" size={32}/><h3>{viewport?'현재 지도 범위에 가맹점이 없습니다':'현재 위치와 지도를 확인하고 있습니다'}</h3><p>{viewport?'지도를 이동하거나 축소해 보세요. 춘천시 가맹점 정보만 제공합니다.':'위치 확인 후 주변 가맹점을 보여드립니다.'}</p><button onClick={reset}>필터 초기화</button></div>:displayed.map(s=><article key={s.id} className={`store-card ${selectedId===s.id?'selected':''}`}><div className="store-top"><span className={`category-label ${color(s.category)}`}>{s.category}</span></div><button className="store-title" aria-pressed={selectedId===s.id} onClick={()=>{setSelectedId(s.id);setSelectionRequest(n=>n+1)}}>{s.name}<span>›</span></button><p className="store-address">{s.address}</p>{s.distanceMeters!==null&&<div className="store-details"><span>{formatStraightDistance(s.distanceMeters)}</span></div>}<div className="store-actions"><button onClick={()=>route(s)}><Icon name="arrow" size={15}/> 길찾기 ↗</button></div></article>)}{visible.length>displayed.length&&<button className="list-load-more" onClick={()=>setListPage({results:visible,limit:listLimit+LIST_PAGE_SIZE})}>가맹점 더 보기 · {displayed.length.toLocaleString()} / {visible.length.toLocaleString()}곳</button>}</div><div className="sidebar-bottom"><Icon name="info" size={13}/> 방문 전 매장 이용 가능 여부를 확인해 주세요.</div></aside>
 <section className="map" aria-label="춘천 중심부 카카오 지도"><KakaoMap onViewportChange={receiveViewport} onLocationChange={receiveLocation} stores={filtered} selectedId={selected?.id??null} onSelect={selectStore} onClusterSelect={selectRegion} centerRequest={centerRequest} selectionRequest={selectionRequest}/>
 {selected&&<div className="map-popup"><div className="popup-head"><span className="popup-kicker">선택한 가맹점</span><button aria-label="매장 상세 닫기" onClick={()=>setSelectedId(null)}>×</button></div><div className="popup-title"><span className="popup-icon"><Icon name="pin" size={23}/></span><div><h2>{selected.name}</h2><p>{selected.category}</p></div></div><div className="popup-info"><p><Icon name="pin" size={16}/>{selected.address}</p></div><div className="popup-actions"><button onClick={()=>route(selected)}><Icon name="arrow" size={17}/>길찾기 ↗</button></div><p className="popup-footnote">방문 전 실제 가맹 여부와 이용 가능 메뉴를 확인해 주세요.</p></div>}
 <div className="map-legend"><strong>가맹점 유형</strong><span><i className="blue"/>일반음식점</span><span><i className="green"/>편의점</span><span><i className="orange"/>베이커리/간식</span><span><i className="purple"/>마트</span></div></section></main>
 <footer className="footer"><div className="footer-brand"><img className="footer-logo" src="/eatda-logo.png" alt="잇다 로고"/><div><strong>잇다(EATDA) 가맹점 안내</strong><p>아이들의 건강한 오늘, 함께 만드는 따뜻한 내일</p></div></div><div className="footer-data">데이터 출처: 춘천시 아동급식카드 가맹점 공공데이터<span>원본 파일 기준일: 2026.08.27 · 팀 전처리 및 좌표 보완 적용</span></div><div className="footer-support"><span>방문 전 매장 이용 가능 여부를 확인해 주세요.</span><div><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('이용약관')}}>이용약관</button><i/><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('개인정보처리방침')}}>개인정보처리방침</button></div></div></footer>
 {policy&&<div className="modal-backdrop" onClick={closePolicy}><section className="policy-modal" role="dialog" aria-modal="true" aria-label={policy} onKeyDown={e=>{if(e.key==='Escape')closePolicy();if(e.key==='Tab')e.preventDefault()}} onClick={e=>e.stopPropagation()}><h2>{policy} · 서비스 안내</h2><p>잇다는 춘천시 공공데이터를 활용하는 비공식 가맹점 안내 서비스입니다. 검색과 필터는 브라우저에서 처리하며, 길찾기는 외부 카카오맵으로 연결됩니다.</p><p>위치 권한을 허용하면 현재 좌표를 지도와 거리 계산에 사용합니다. 음성 검색 시 녹음 파일은 서버와 Groq에, 도보 경로 조회 시 현재 위치와 후보 매장 좌표는 서버와 TMAP에 전송됩니다. 가맹 여부와 이용 조건은 방문 전 매장에 확인해 주세요.</p><button autoFocus onClick={closePolicy}>확인</button></section></div>}
 </div>
}
export default App





