export type Coordinates = { lat: number; lng: number }
export type GeoResult = { x: string; y: string }
export type RegionResult = { region_type: string; region_2depth_name: string; region_3depth_name: string }
export function sdkUrl(key: string) {
 const value=key.trim()
 if(!value || /여기에|발급받은|입력|your.?key/i.test(value)) throw new Error('.env.local에 카카오 JavaScript 키를 입력해 주세요.')
 const url=new URL('https://dapi.kakao.com/v2/maps/sdk.js')
 url.searchParams.set('appkey',value)
 url.searchParams.set('autoload','false')
 // Kakao's bootstrap splits the raw libraries query on commas without decoding it.
 // Keep appkey safely encoded, but append the fixed library names with a literal comma.
 return `${url.toString()}&libraries=services,clusterer`
}
export function parseCoordinates(results: GeoResult[]): Coordinates | null {
 const first=results[0]
 if(!first || !first.x.trim() || !first.y.trim()) return null
 const lat=Number(first.y),lng=Number(first.x)
 return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null
}
export function regionLabel(results: RegionResult[]) {
 const region=results.find(result=>result.region_type==='H')??results[0]
 const city=region?.region_2depth_name?.trim()||'춘천시'
 const dong=region?.region_3depth_name?.trim()
 return dong?`${city} 가맹점 지도 · ${dong}`:'춘천시 가맹점 지도'
}
export interface MapPosition { getLat(): number; getLng(): number }
export interface MapBounds { getSouthWest(): MapPosition; getNorthEast(): MapPosition }
export interface MapInstance {
 panTo(position:MapPosition):void; setCenter(position:MapPosition):void;
 setLevel(level:number):void; getLevel():number; getCenter():MapPosition;
 getBounds():MapBounds; setMinLevel(level:number):void; setMaxLevel(level:number):void; relayout():void
}
export interface MapOverlay { setMap(map:MapInstance|null):void }
export interface MapMarker extends MapOverlay {
 getPosition():MapPosition; setImage(image:object):void; setZIndex(index:number):void
}
export interface MapCluster {
 getMarkers():MapMarker[]; getCenter():MapPosition; getSize():number;
 getClusterMarker():{getContent():HTMLElement|string}
}
export interface MapClusterer {
 addMarkers(markers:MapMarker[]):void; clear():void; redraw():void
}
export interface MapsSDK {
 load(callback:()=>void):void
 LatLng:new(lat:number,lng:number)=>MapPosition
 Map:new(container:HTMLElement,options:{center:MapPosition;level:number;keyboardShortcuts:boolean})=>MapInstance
 CustomOverlay:new(options:{map:MapInstance;position:MapPosition;content:HTMLElement;yAnchor:number;zIndex:number})=>MapOverlay
 Size:new(width:number,height:number)=>object
 MarkerImage:new(source:string,size:object)=>object
 Marker:new(options:{position:MapPosition;image:object;title:string;clickable:boolean;zIndex:number})=>MapMarker
 MarkerClusterer:new(options:{map:MapInstance;averageCenter:boolean;minLevel:number;gridSize:number;minClusterSize:number;disableClickZoom:boolean;styles:Record<string,string>[]})=>MapClusterer
 services:{Status:{OK:string};Geocoder:new()=>{addressSearch(address:string,callback:(result:GeoResult[],status:string)=>void):void;coord2RegionCode(x:number,y:number,callback:(result:RegionResult[],status:string)=>void):void}}
 event:{
  preventMap():void
  addListener(target:MapMarker,event:'click',handler:()=>void):void
  addListener(target:MapClusterer,event:'clusterclick',handler:(cluster:MapCluster)=>void):void
  addListener(target:MapClusterer,event:'clustered',handler:(clusters:MapCluster[])=>void):void
  addListener(target:MapInstance,event:'idle',handler:()=>void):void
  removeListener(target:MapMarker,event:'click',handler:()=>void):void
  removeListener(target:MapClusterer,event:'clusterclick',handler:(cluster:MapCluster)=>void):void
  removeListener(target:MapClusterer,event:'clustered',handler:(clusters:MapCluster[])=>void):void
  removeListener(target:MapInstance,event:'idle',handler:()=>void):void
 }
}
declare global { interface Window { kakao?:{maps:MapsSDK} } }
let pending:Promise<MapsSDK>|null=null
export function loadKakaoMaps(key:string):Promise<MapsSDK> {
 let url:string
 try { url=sdkUrl(key) } catch(error) { return Promise.reject(error) }
 if(pending)return pending
 pending=new Promise<MapsSDK>((resolve,reject)=>{
  const script=document.createElement('script')
  script.async=true;script.src=url
  let finished=false
  const timeout=window.setTimeout(()=>fail(),15000)
  function fail(){
   if(finished)return
   finished=true;window.clearTimeout(timeout);script.remove();pending=null
   reject(new Error('카카오맵을 불러오지 못했습니다. JavaScript 키, 등록 도메인, 카카오맵 사용 설정과 네트워크를 확인해 주세요.'))
  }
  script.onerror=fail
  script.onload=()=>{
   if(finished)return
   const maps=window.kakao?.maps
   if(!maps){fail();return}
   try {maps.load(()=>{
    if(finished)return
    if(!maps.Map || !maps.services || !maps.MarkerClusterer){fail();return}
    finished=true;window.clearTimeout(timeout);resolve(maps)
   })}catch{fail()}
  }
  document.head.appendChild(script)
 })
 return pending
}
export function geocodeAddress(maps:MapsSDK,address:string):Promise<Coordinates|null> {
 return new Promise(resolve=>{
  const timer=window.setTimeout(()=>resolve(null),8000)
  try{new maps.services.Geocoder().addressSearch(address,(results,status)=>{
   window.clearTimeout(timer)
   resolve(status===maps.services.Status.OK?parseCoordinates(results):null)
  })}catch{window.clearTimeout(timer);resolve(null)}
 })
}
