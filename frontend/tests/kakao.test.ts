import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sdkUrl, parseCoordinates } from '../src/kakao.ts'
test('requires a non-placeholder key and loads services without auto initialization',()=>{
 assert.throws(()=>sdkUrl(''),/JavaScript/)
 assert.throws(()=>sdkUrl('발급받은_JavaScript_키'),/JavaScript/)
 const url=new URL(sdkUrl('test-key'))
 assert.equal(url.origin,'https://dapi.kakao.com')
 assert.equal(url.searchParams.get('autoload'),'false')
 assert.equal(url.searchParams.get('libraries'),'services,clusterer')
 assert.match(sdkUrl('test-key'), /[?&]libraries=services,clusterer(?:&|$)/)
 assert.ok(!sdkUrl('test-key').includes('%2C'))
})
test('parses geocoded longitude/latitude and rejects missing or invalid results',()=>{
 assert.deepEqual(parseCoordinates([{x:'127.73',y:'37.88'}]),{lat:37.88,lng:127.73})
 for(const data of [[],[{x:'',y:''}],[{x:'NaN',y:'37'}],[{x:'181',y:'37'}],[{x:'127',y:'91'}]]) assert.equal(parseCoordinates(data),null)
})


