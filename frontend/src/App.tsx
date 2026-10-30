import NearestVoice from './NearestVoice'
import { parseVoiceIntent } from './voiceIntent'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopeMerchants } from './mapClusters'
import KakaoMap from './KakaoMap'
import type { ReactNode } from 'react'
import VoiceSearch from './VoiceSearch'
import { filterMerchants, merchants } from './merchants'
import type { Merchant } from './merchants'
import './App.css'
function Icon({name,size=20}:{name:string;size?:number}) {
 const paths:Record<string,ReactNode>={search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,pin:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,arrow:<><path d="m4 10 16-6-6 16-3-7-7-3Z"/><path d="m11 13 9-9"/></>,phone:<path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 5-4 5-7 3C7 17 3 12 3 7c0-3 2-4 4-4Z"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,reset:<><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></>,target:<><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,leaf:<><path d="M20 3C8 1 2 7 5 15c8 5 16-1 15-12Z"/><path d="M3 21 15 9"/></>,chevron:<path d="m7 10 5 5 5-5"/>}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.pin}</svg>
}
const categories=['전체','한식','중식','일식','양식','제과점','편의점','마트']
const color=(c:string)=>c==='편의점'?'green':c==='베이커리/간식'?'orange':c==='마트'?'purple':'blue'
function App(){
 const [voiceSearchRequest, setVoiceSearchRequest] = useState(0)
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[category,setCategory]=useState('전체')
 const [open,setOpen]=useState(false),[delivery,setDelivery]=useState(false),[distance,setDistance]=useState(false)
 const [selectionRequest,setSelectionRequest]=useState(0)
 const [selectedId,setSelectedId]=useState<number|null>(null),[regionOpen,setRegionOpen]=useState(false),[centerRequest,setCenterRequest]=useState(0)
 const [notice,setNotice]=useState(''),[policy,setPolicy]=useState<string|null>(null)
 const policyTrigger=useRef<HTMLButtonElement|null>(null)
 const closePolicy=()=>{setPolicy(null);policyTrigger.current?.focus()}
 const [clusterIds,setClusterIds]=useState<number[]|null>(null)
 const resultsHeading=useRef<HTMLDivElement>(null)
 const filtered=useMemo(()=>filterMerchants(merchants,{query:search,category,open,delivery,distance}),[search,category,open,delivery,distance])
 const visible=useMemo(()=>scopeMerchants(filtered,clusterIds),[filtered,clusterIds])
 const selectStore=useCallback((id:number)=>{setSelectedId(id);setClusterIds(ids=>ids?.includes(id)?ids:null)},[])
 const selectRegion=useCallback((ids:number[])=>{setClusterIds(ids);setSelectedId(null)},[])
 useEffect(()=>{if(clusterIds!==null)resultsHeading.current?.focus()},[clusterIds])
 const clearRegion=()=>{setClusterIds(null);setSelectedId(null);requestAnimationFrame(()=>resultsHeading.current?.focus())}
 const selected=visible.find(s=>s.id===selectedId)
 const reset=()=>{setQuery('');setSearch('');setCategory('전체');setOpen(false);setDelivery(false);setDistance(false);setSelectedId(null);setClusterIds(null)}
 const route=(s:Merchant)=>window.open(`https://map.kakao.com/link/search/${encodeURIComponent(s.name+' 춘천')}`,'_blank','noopener,noreferrer')
 const phone=()=>setNotice('디자인 시안의 예시 전화번호입니다. 실제 전화 연결은 제공하지 않습니다.')
 return <div className="portal">
 <header className="header"><a className="brand" href="#finder" onClick={reset}><span className="brand-icon"><Icon name="leaf" size={25}/></span><strong>오늘 뭐 먹지</strong></a><nav><a className="nav-active" href="#finder">가맹점 찾기</a></nav><div className="region-wrap"><button className="region-button" onClick={()=>setRegionOpen(!regionOpen)} aria-expanded={regionOpen}><Icon name="pin" size={17}/><span>지역 설정 <b>강원도 춘천시</b></span><Icon name="chevron" size={16}/></button>{regionOpen&&<div className="region-menu"><strong>서비스 지역</strong><button onClick={()=>{setRegionOpen(false);reset();setCenterRequest(n=>n+1)}}>강원특별자치도 춘천시 <span>✓</span></button><p>현재 시안은 춘천시의 예시 매장을 제공합니다.</p></div>}</div></header>
 <div className="announcement"><Icon name="info" size={17}/><strong>이용 안내</strong><p>배달 주문은 매장에 문의 후 이용하시기 바랍니다. <span>일부 가맹점은 포장 및 매장 식사만 지원됩니다.</span></p><span className="banner-tag">함께하는 따뜻한 한 끼</span></div>
 <main id="finder" className="split"><aside className="sidebar" aria-label="가맹점 검색 및 목록"><section className="search-section"><div className="eyebrow">우리 동네 든든한 한 끼</div><h1>어디서 먹을까요<span>?</span></h1><p className="intro">가까운 급식카드 가맹점을 찾아보세요.</p><form onSubmit={e=>{e.preventDefault();setSearch(query);setSelectedId(null);setClusterIds(null)}}><div className="search-input"><Icon name="search"/><input aria-label="가맹점 이름 또는 주소" placeholder="가맹점 이름, 주소로 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="search-submit" type="submit" aria-label="검색"><Icon name="search"/></button></div><div className="search-meta"><span><Icon name="pin" size={13}/> 춘천시 전체</span><button type="button" onClick={reset}><Icon name="reset" size={13}/> 초기화</button></div></form>
<VoiceSearch
  resultCount={filtered.length}
  onRecognized={(text) => {
    const intent = parseVoiceIntent(text)

    setQuery(intent.query)
    setSearch(intent.query)
    setCategory(categories[intent.categoryIndex])

    setOpen(false)
    setDelivery(false)
    setDistance(false)

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
 <section className="filter-section" aria-label="검색 필터"><div className="chips">{categories.map(c=><button key={c} className={category===c?'chip active':'chip'} aria-pressed={category===c} onClick={()=>{setCategory(c);setClusterIds(null);setSelectedId(null)}}>{c}</button>)}</div><div className="checks"><label><input type="checkbox" checked={open} onChange={e=>{setOpen(e.target.checked);setClusterIds(null);setSelectedId(null)}}/>현재 영업중</label><label><input type="checkbox" checked={delivery} onChange={e=>{setDelivery(e.target.checked);setClusterIds(null);setSelectedId(null)}}/>배달가능 매장</label></div></section><div className="results-heading" ref={resultsHeading} tabIndex={-1}><span>{clusterIds===null?'주변 가맹점':'선택 지역 가맹점'} <b>{visible.length}</b><small>곳</small></span><button onClick={()=>setDistance(!distance)} aria-pressed={distance}>↕ {distance?'거리순 (시청 기준)':'기본순'} <Icon name="chevron" size={13}/></button></div>
 {clusterIds!==null&&<div className="cluster-selection"><span><Icon name="pin" size={14}/>선택한 묶음의 가맹점 {visible.length}곳</span><button onClick={clearRegion}>전체 목록 보기 ×</button></div>}
 <div className="store-list" aria-live="polite">{!visible.length?<div className="empty"><Icon name="search" size={32}/><h3>검색 결과가 없습니다</h3><p>검색어나 필터를 변경해 보세요.</p><button onClick={reset}>필터 초기화</button></div>:visible.map(s=><article key={s.id} className={`store-card ${selectedId===s.id?'selected':''}`}><div className="store-top"><span className={`category-label ${color(s.category)}`}>{s.category}</span><span className={`status ${s.open?'':'closed'}`}>● {s.open?'영업중':'영업종료'}</span></div><button className="store-title" aria-pressed={selectedId===s.id} onClick={()=>{setSelectedId(s.id);setSelectionRequest(n=>n+1)}}>{s.name}<span>›</span></button><p className="store-address">{s.address}</p><div className="store-details"><span>{s.phone} <small>(예시)</small></span><span>{s.distance}m</span></div><div className="menu-tags"><span className="meal-tag">급식카드 추천</span>{s.menu.map(m=><span key={m}>{m}</span>)}</div><div className="store-actions"><button onClick={()=>route(s)}><Icon name="arrow" size={15}/> 길찾기 ↗</button><button onClick={phone}><Icon name="phone" size={14}/> 전화 안내</button>{s.delivery&&<span className="delivery-tag">배달 가능</span>}</div></article>)}</div><div className="sidebar-bottom"><Icon name="info" size={13}/> 매장·거리·가격·영업 상태는 모두 예시 정보입니다.</div></aside>
 <section className="map" aria-label="춘천 중심부 카카오 지도"><KakaoMap stores={filtered} selectedId={selected?.id??null} onSelect={selectStore} onClusterSelect={selectRegion} centerRequest={centerRequest} selectionRequest={selectionRequest}/>
 {selected&&<div className="map-popup"><div className="popup-head"><span className="popup-kicker">선택한 가맹점 <span>예시</span></span><button aria-label="매장 상세 닫기" onClick={()=>setSelectedId(null)}>×</button></div><div className="popup-title"><span className="popup-icon"><Icon name="pin" size={23}/></span><div><h2>{selected.name}</h2><p>{selected.category} <span>·</span> <b>{selected.open?'영업중':'영업종료'}</b></p></div></div><div className="popup-info"><p><Icon name="pin" size={16}/>{selected.address}</p><p><Icon name="clock" size={16}/>{selected.hours}<span>예시 영업시간</span></p><p><Icon name="phone" size={16}/>{selected.phone}<span>예시 번호</span></p></div><div className="popup-meal"><span>든든한 한 끼 추천</span><strong>{selected.menu.join(' · ')}</strong></div><div className="popup-actions"><button onClick={()=>route(selected)}><Icon name="arrow" size={17}/>길찾기 ↗</button><button onClick={phone}><Icon name="phone" size={16}/>전화 안내</button></div><p className="popup-footnote">방문 전 실제 가맹 여부와 이용 가능 메뉴를 확인해 주세요.</p></div>}
 <div className="map-legend"><strong>가맹점 유형</strong><span><i className="blue"/>일반음식점</span><span><i className="green"/>편의점</span><span><i className="orange"/>베이커리/간식</span><span><i className="purple"/>마트</span></div></section></main>
 <footer className="footer"><div className="footer-brand"><Icon name="leaf" size={24}/><div><strong>푸르미 아동급식카드 종합지원센터</strong><p>아이들의 건강한 오늘, 함께 만드는 따뜻한 내일</p></div></div><div className="footer-data">지자체 아동복지과 공공데이터 연계 안내<span>비공식 디자인 시안이며, 실제 가맹점 정보가 아닙니다.</span></div><div className="footer-support"><span>고객지원 문의 <strong>1544-3674</strong></span><div><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('이용약관')}}>이용약관</button><i/><button onClick={e=>{policyTrigger.current=e.currentTarget;setPolicy('개인정보처리방침')}}>개인정보처리방침</button></div></div></footer>
 {notice&&<div className="toast" role="status"><Icon name="info" size={18}/>{notice}<button aria-label="알림 닫기" onClick={()=>setNotice('')}>×</button></div>}
 {policy&&<div className="modal-backdrop" onClick={closePolicy}><section className="policy-modal" role="dialog" aria-modal="true" aria-label={policy} onKeyDown={e=>{if(e.key==='Escape')closePolicy();if(e.key==='Tab')e.preventDefault()}} onClick={e=>e.stopPropagation()}><h2>{policy} · 시안 안내</h2><p>이 화면은 비공식 디자인 프로토타입입니다. 개인정보를 수집하거나 저장하지 않으며 검색과 필터는 브라우저 안에서 처리합니다. 길찾기는 외부 카카오맵 검색으로 연결됩니다.</p><p>실제 약관 및 개인정보처리방침은 운영기관의 공식 안내를 확인해 주세요.</p><button autoFocus onClick={closePolicy}>확인</button></section></div>}
 </div>
}
export default App





