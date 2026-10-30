import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectCluster, scopeMerchants } from '../src/mapClusters.ts'
import { merchants, filterMerchants } from '../src/merchants.ts'

test('clicking a seven-marker cluster selects exactly seven original stores before navigating',()=>{
 const markers=Array.from({length:7},()=>({}))
 const ids=new Map(markers.map((marker,i)=>[marker,i+1]))
 const center={getLat:()=>37.88,getLng:()=>127.73}
 const actions:unknown[]=[]
 const cluster={getMarkers:()=>markers,getCenter:()=>center}
 const map={getLevel:()=>6,setLevel:(level:number)=>actions.push(level),panTo:(point:unknown)=>actions.push(point)}
 selectCluster(cluster,ids,map,selected=>actions.push(selected))
 assert.deepEqual(actions,[[1,2,3,4,5,6,7],5,center])
 assert.equal(scopeMerchants(merchants,actions[0] as number[]).length,7)
})
test('cluster IDs use marker identity, deduplicate members and ignore unknown markers',()=>{
 const known={},unknown={}
 const results:number[][]=[]
 const levels:number[]=[]
 selectCluster({getMarkers:()=>[known,known,unknown],getCenter:()=>({})},new Map([[known,9]]),{getLevel:()=>1,setLevel:n=>levels.push(n),panTo:()=>{}},ids=>results.push(ids))
 assert.deepEqual(results,[[9]])
 assert.deepEqual(levels,[1])
 selectCluster({getMarkers:()=>[unknown],getCenter:()=>({})},new Map(),{getLevel:()=>1,setLevel:()=>assert.fail(),panTo:()=>assert.fail()},()=>assert.fail())
})
test('cluster scope intersects filters, preserves sort and can restore the full filtered list',()=>{
 const filtered=filterMerchants(merchants,{query:'',category:'일반음식점',open:true,delivery:false,distance:true})
 const group=[1,3,7,8,9,10,11]
 const scoped=scopeMerchants(filtered,group)
 assert.deepEqual(scoped,filtered.filter(store=>group.includes(store.id)))
 assert.deepEqual(scopeMerchants(filtered,null),filtered)
 assert.deepEqual(scopeMerchants(filtered,[]),[])
 assert.equal(merchants.length,16)
 assert.equal(new Set(merchants.map(store=>store.id)).size,16)
 assert.ok(merchants.every(store=>store.coordinates && store.phone.startsWith('033-')))
})
