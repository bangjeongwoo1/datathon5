import { useEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from './kakao'
import type { Coordinates, MapCluster, MapClusterer, MapInstance, MapMarker, MapsSDK } from './kakao'
import { merchants } from './merchants'
import type { Merchant } from './merchants'
import { selectCluster } from './mapClusters'
import { markerSvg } from './markerIcon'
import { buildPersistedPositions } from './mapPositions'

const CITY_HALL={lat:37.8813,lng:127.73}
const colors:Record<string,string>={'일반음식점':'#2563eb','편의점':'#15957e','베이커리/간식':'#dc9341','마트':'#7c3aed'}
type Props={stores:Merchant[];selectedId:number|null;onSelect:(id:number)=>void;onClusterSelect:(ids:number[])=>void;centerRequest:number;selectionRequest:number}
type ReadyMap={maps:MapsSDK;map:MapInstance;clusterer:MapClusterer;positions:Map<number,Coordinates>}
let positionsPromise:Promise<Map<number,Coordinates>>|null=null
function merchantPositions(){
 if(!positionsPromise) positionsPromise=Promise.resolve(buildPersistedPositions(merchants))
 return positionsPromise
}
function markerImage(maps:MapsSDK,store:Merchant,selected:boolean){
 const fill=colors[store.category]||'#2563eb'
 const svg=markerSvg(fill)
 return new maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new maps.Size(selected?44:34,selected?53:41))
}
export default function KakaoMap({stores,selectedId,onSelect,onClusterSelect,centerRequest,selectionRequest}:Props){
 const container=useRef<HTMLDivElement>(null)
 const markerEntries=useRef<{marker:MapMarker;store:Merchant}[]>([])
 const [ready,setReady]=useState<ReadyMap|null>(null)
 const [error,setError]=useState('')
 const [retry,setRetry]=useState(0)
 const [phase,setPhase]=useState('카카오맵을 불러오고 있습니다…')

 useEffect(()=>{
  let cancelled=false
  let observer:ResizeObserver|undefined
  let clusterer:MapClusterer|undefined
  const host=container.current
  if(!host)return
  setError('');setReady(null);setPhase('카카오맵을 불러오고 있습니다…')
  loadKakaoMaps(import.meta.env.VITE_KAKAO_MAP_APP_KEY||'').then(async maps=>{
   if(cancelled)return
   const map=new maps.Map(host,{center:new maps.LatLng(CITY_HALL.lat,CITY_HALL.lng),level:4,keyboardShortcuts:true})
   map.setMinLevel(1);map.setMaxLevel(10)
   clusterer=new maps.MarkerClusterer({
    map,averageCenter:true,minLevel:4,gridSize:80,minClusterSize:2,disableClickZoom:true,
    styles:[{width:'56px',height:'56px',background:'#2563eb',color:'#fff',textAlign:'center',lineHeight:'44px',fontSize:'17px',fontWeight:'700',border:'6px solid #a9c5ff',borderRadius:'50%',boxSizing:'border-box',boxShadow:'0 3px 12px #1d4ed830',cursor:'pointer'}],
   })
   observer=new ResizeObserver(()=>{const center=map.getCenter();map.relayout();map.setCenter(center);clusterer?.redraw()})
   observer.observe(host)
   setPhase('예시 매장 위치를 지도에 연결하고 있습니다…')
   const positions=await merchantPositions()
   if(cancelled)return
   setReady({maps,map,clusterer,positions});setPhase('')
  }).catch(()=>{
   if(!cancelled){setPhase('');setError('카카오맵을 불러오지 못했습니다. .env.local의 JavaScript 키, 현재 접속 주소의 SDK 도메인 등록, 카카오맵 사용 설정을 확인해 주세요.')}
  })
  return()=>{cancelled=true;observer?.disconnect();clusterer?.clear();host.replaceChildren()}
 },[retry])

 // Keep one SDK clusterer per map. Filtering changes its markers, not the instance.
 useEffect(()=>{
  if(!ready)return
  const {maps,map,clusterer,positions}=ready
  const markerIds=new Map<MapMarker,number>()
  const disposers:(()=>void)[]=[]
  const keyboardTargets=new Set<HTMLElement>()
  const onClusterClick=(cluster:MapCluster)=>selectCluster(cluster,markerIds,map,onClusterSelect)
  const onClustered=(clusters:MapCluster[])=>{
   for(const target of keyboardTargets)target.onkeydown=null
   keyboardTargets.clear()
   for(const cluster of clusters){
    if(cluster.getSize()<2)continue
    const content=cluster.getClusterMarker().getContent()
    if(!(content instanceof HTMLElement))continue
    content.setAttribute('role','button');content.tabIndex=0
    content.setAttribute('aria-label',`이 지역 가맹점 ${cluster.getSize()}곳 보기`)
    content.onkeydown=event=>{
     if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();maps.event.preventMap();onClusterClick(cluster)}
    }
    keyboardTargets.add(content)
   }
  }
  maps.event.addListener(clusterer,'clusterclick',onClusterClick)
  maps.event.addListener(clusterer,'clustered',onClustered)
  const entries:{marker:MapMarker;store:Merchant}[]=[]
  for(const store of stores){
   const coordinates=positions.get(store.id)
   if(!coordinates)continue
   const marker=new maps.Marker({position:new maps.LatLng(coordinates.lat,coordinates.lng),image:markerImage(maps,store,false),title:`${store.name} (예시 위치)`,clickable:true,zIndex:2})
   markerIds.set(marker,store.id)
   const click=()=>onSelect(store.id)
   maps.event.addListener(marker,'click',click)
   disposers.push(()=>maps.event.removeListener(marker,'click',click))
   entries.push({marker,store})
  }
  markerEntries.current=entries
  clusterer.addMarkers(entries.map(entry=>entry.marker))
  return()=>{
   maps.event.removeListener(clusterer,'clusterclick',onClusterClick)
   maps.event.removeListener(clusterer,'clustered',onClustered)
   for(const target of keyboardTargets)target.onkeydown=null
   disposers.forEach(dispose=>dispose());clusterer.clear();markerEntries.current=[]
  }
 },[ready,stores,onSelect,onClusterSelect])

 useEffect(()=>{
  if(!ready)return
  for(const {marker,store} of markerEntries.current){
   marker.setImage(markerImage(ready.maps,store,store.id===selectedId))
   marker.setZIndex(store.id===selectedId?5:2)
  }
 },[ready,stores,selectedId])
 useEffect(()=>{
  if(!ready)return
  const position=selectedId===null?undefined:ready.positions.get(selectedId)
  if(position){ready.map.setLevel(Math.min(3,ready.map.getLevel()));ready.map.panTo(new ready.maps.LatLng(position.lat,position.lng))}
 },[ready,selectedId,selectionRequest])
 useEffect(()=>{
  if(!ready||!centerRequest)return
  ready.map.setLevel(4);ready.map.panTo(new ready.maps.LatLng(CITY_HALL.lat,CITY_HALL.lng))
 },[ready,centerRequest])
 function changeZoom(change:number){if(!ready)return;const level=Math.max(1,Math.min(10,ready.map.getLevel()+change));ready.map.setLevel(level)}
 return <><div ref={container} className="kakao-map-canvas" aria-label="카카오맵 춘천시 가맹점 지도"/>
 <div className="map-location"><b>강원특별자치도 춘천시</b><span>중앙로 · 명동 일대</span></div>
 <div className="map-preview-label">카카오맵</div>
 <div className="map-cluster-hint">숫자 마커를 누르면 해당 지역의 가맹점만 볼 수 있어요.</div>
 {(phase||error)&&<div className="map-load-state" role={error?'alert':'status'}><strong>{error?'지도를 표시할 수 없습니다':'지도 연결 중'}</strong><p>{error||phase}</p>{error&&<button onClick={()=>{positionsPromise=null;setRetry(n=>n+1)}}>다시 시도</button>}</div>}
 {ready&&<div className="map-controls"><button aria-label="춘천시청 기준 위치로 이동" title="춘천시청 기준 위치" onClick={()=>{ready.map.setLevel(4);ready.map.panTo(new ready.maps.LatLng(CITY_HALL.lat,CITY_HALL.lng))}}>◎</button><div><button aria-label="지도 확대" onClick={()=>changeZoom(-1)}>+</button><button aria-label="지도 축소" onClick={()=>changeZoom(1)}>−</button></div></div>}
 </>
}
