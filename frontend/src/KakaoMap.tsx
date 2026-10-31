import { useEffect, useRef, useState } from 'react'
import { loadKakaoMaps, regionLabel } from './kakao'
import type { Coordinates, MapCluster, MapClusterer, MapInstance, MapMarker, MapsSDK } from './kakao'
import { merchants } from './merchants'
import type { Merchant } from './merchants'
import { selectCluster } from './mapClusters'
import { markerSvg } from './markerIcon'
import { buildPersistedPositions, filterStoresInBounds } from './mapPositions'
import type { ViewportBounds } from './mapPositions'
import { requestCurrentLocation } from './userLocation'
import { moveMapToCurrentLocation } from './mapCurrentLocation'

const CITY_HALL={lat:37.8813,lng:127.73}
const colors:Record<string,string>={'일반음식점':'#2563eb','편의점':'#15957e','베이커리/간식':'#dc9341','마트':'#7c3aed'}
type Props={onViewportChange:(bounds:ViewportBounds)=>void;onLocationChange:(position:Coordinates)=>void;stores:Merchant[];selectedId:number|null;onSelect:(id:number)=>void;onClusterSelect:(ids:number[])=>void;centerRequest:number;selectionRequest:number}
type ReadyMap={maps:MapsSDK;map:MapInstance;clusterer:MapClusterer;positions:Map<number,Coordinates>}
let positionsPromise:Promise<Map<number,Coordinates>>|null=null
function merchantPositions(){
 if(!positionsPromise) positionsPromise=Promise.resolve(buildPersistedPositions(merchants))
 return positionsPromise
}
function markerImage(maps:MapsSDK,store:Merchant,selected:boolean){
 const fill=colors[store.category]||'#2563eb'
 const svg=markerSvg(fill)
 return new maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new maps.Size(selected?36:28,selected?46:36))
}
export default function KakaoMap({onViewportChange,onLocationChange,stores,selectedId,onSelect,onClusterSelect,centerRequest,selectionRequest}:Props){
 const container=useRef<HTMLDivElement>(null)
 const markerEntries=useRef<{marker:MapMarker;store:Merchant}[]>([])
 const currentLocationMarker=useRef<MapMarker|null>(null)
 const [ready,setReady]=useState<ReadyMap|null>(null)
 const [error,setError]=useState('')
 const [retry,setRetry]=useState(0)
 const [phase,setPhase]=useState('카카오맵을 불러오고 있습니다…')
 const [viewport,setViewport]=useState<ViewportBounds|null>(null)
 const [locationLabel,setLocationLabel]=useState('춘천시 가맹점 지도')

 useEffect(()=>{
  let cancelled=false
  let observer:ResizeObserver|undefined
  let clusterer:MapClusterer|undefined
 let idleMap:MapInstance|undefined
 let idleMaps:MapsSDK|undefined
 let updateViewport:(()=>void)|undefined
 let regionTimer:number|undefined
 let regionRequest=0
  const host=container.current
  if(!host)return
  setError('');setReady(null);setViewport(null);setPhase('카카오맵을 불러오고 있습니다…')
  setPhase('현재 위치와 카카오맵을 확인하고 있습니다…')
  Promise.all([loadKakaoMaps(import.meta.env.VITE_KAKAO_MAP_APP_KEY||''),requestCurrentLocation().catch(()=>null)]).then(async ([maps,initialLocation])=>{
   idleMaps=maps
   if(cancelled)return
   const initialCenter=initialLocation??CITY_HALL
   const map=new maps.Map(host,{center:new maps.LatLng(initialCenter.lat,initialCenter.lng),level:initialLocation?3:4,keyboardShortcuts:true})
   map.setMinLevel(1);map.setMaxLevel(10)
   clusterer=new maps.MarkerClusterer({
    map,averageCenter:true,minLevel:4,gridSize:80,minClusterSize:2,disableClickZoom:true,
    styles:[{width:'56px',height:'56px',background:'#2563eb',color:'#fff',textAlign:'center',lineHeight:'44px',fontSize:'17px',fontWeight:'700',border:'6px solid #a9c5ff',borderRadius:'50%',boxSizing:'border-box',boxShadow:'0 3px 12px #1d4ed830',cursor:'pointer'}],
   })
   observer=new ResizeObserver(()=>{const center=map.getCenter();map.relayout();map.setCenter(center);clusterer?.redraw();updateViewport?.()})
   observer.observe(host)
   const geocoder=new maps.services.Geocoder()
   idleMap=map
   updateViewport=()=>{const bounds=map.getBounds(),southWest=bounds.getSouthWest(),northEast=bounds.getNorthEast();const nextBounds={south:southWest.getLat(),west:southWest.getLng(),north:northEast.getLat(),east:northEast.getLng()};setViewport(nextBounds);onViewportChange(nextBounds);const request=++regionRequest;if(regionTimer)window.clearTimeout(regionTimer);regionTimer=window.setTimeout(()=>{const center=map.getCenter();geocoder.coord2RegionCode(center.getLng(),center.getLat(),(results,status)=>{if(!cancelled&&request===regionRequest&&status===maps.services.Status.OK)setLocationLabel(regionLabel(results))})},250)}
   maps.event.addListener(map,'idle',updateViewport)
   updateViewport()
   requestCurrentLocation().then(position=>{
    if(cancelled)return
    currentLocationMarker.current?.setMap(null)
    currentLocationMarker.current=new maps.Marker({
     position:new maps.LatLng(position.lat,position.lng),
     title:'현재 위치',
     clickable:false,
     zIndex:6,
    })
    currentLocationMarker.current.setMap(map)
    moveMapToCurrentLocation(map,maps,position)
    onLocationChange(position)
   }).catch(()=>{
    // 위치 권한을 거부하거나 좌표를 받지 못하면 기존 춘천시 중심 화면을 유지한다.
   })
   setPhase('가맹점 위치를 지도에 연결하고 있습니다…')
   const positions=await merchantPositions()
   if(cancelled)return
   setReady({maps,map,clusterer,positions});setPhase('')
  }).catch(()=>{
   if(!cancelled){setPhase('');setError('카카오맵을 불러오지 못했습니다. .env.local의 JavaScript 키, 현재 접속 주소의 SDK 도메인 등록, 카카오맵 사용 설정을 확인해 주세요.')}
  })
  return()=>{cancelled=true;if(regionTimer)window.clearTimeout(regionTimer);observer?.disconnect();if(idleMaps&&idleMap&&updateViewport)idleMaps.event.removeListener(idleMap,'idle',updateViewport);currentLocationMarker.current?.setMap(null);currentLocationMarker.current=null;clusterer?.clear();host.replaceChildren()}
 },[retry,onLocationChange,onViewportChange])

 // Keep one SDK clusterer per map. Filtering changes its markers, not the instance.
 useEffect(()=>{
  if(!ready)return
  const {maps,map,clusterer,positions}=ready
  if(!viewport)return
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
  for(const store of filterStoresInBounds(stores,positions,viewport)){
   const coordinates=positions.get(store.id)
   if(!coordinates)continue
   const marker=new maps.Marker({position:new maps.LatLng(coordinates.lat,coordinates.lng),image:markerImage(maps,store,false),title:store.name,clickable:true,zIndex:2})
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
 },[ready,stores,viewport,onSelect,onClusterSelect])

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
 function moveToCurrentLocation(){
  if(!ready)return
  requestCurrentLocation().then(position=>{
   currentLocationMarker.current?.setMap(null)
   currentLocationMarker.current=new ready.maps.Marker({position:new ready.maps.LatLng(position.lat,position.lng),title:'현재 위치',clickable:false,zIndex:6})
   currentLocationMarker.current.setMap(ready.map)
   moveMapToCurrentLocation(ready.map,ready.maps,position)
   onLocationChange(position)
  }).catch(()=>setLocationLabel('현재 위치를 확인하지 못했습니다. 위치 권한을 확인해 주세요.'))
 }
 function changeZoom(change:number){if(!ready)return;const level=Math.max(1,Math.min(10,ready.map.getLevel()+change));ready.map.setLevel(level)}
 return <><div ref={container} className="kakao-map-canvas" aria-label="카카오맵 춘천시 가맹점 지도"/>
 <div className="map-location"><b>{locationLabel}</b></div>
 <div className="map-preview-label">카카오맵</div>
 <div className="map-cluster-hint">지도를 움직이면 현재 지도 안의 가맹점 목록이 갱신됩니다.</div>
 {(phase||error)&&<div className="map-load-state" role={error?'alert':'status'}><strong>{error?'지도를 표시할 수 없습니다':'지도 연결 중'}</strong><p>{error||phase}</p>{error&&<button onClick={()=>{positionsPromise=null;setRetry(n=>n+1)}}>다시 시도</button>}</div>}
 {ready&&<div className="map-controls"><button aria-label="현재 위치로 이동" title="현재 위치로 이동" onClick={moveToCurrentLocation}>◎</button><div><button aria-label="지도 확대" onClick={()=>changeZoom(-1)}>+</button><button aria-label="지도 축소" onClick={()=>changeZoom(1)}>−</button></div></div>}
 </>
}
