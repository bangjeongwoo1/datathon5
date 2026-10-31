import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPersistedPositions, filterStoresInBounds } from '../src/mapPositions.ts'
import { toMerchant } from '../src/merchantData.ts'
import { withDistances, sortByDistance } from '../src/merchantDistance.ts'

test('지도 범위가 바뀌면 목록도 바뀌고 GPS 거리와 가까운순을 유지한다', () => {
  const stores = [37.88,37.881,37.90].map((lat,index)=>toMerchant({
    id:index+1,name:`매장 ${index+1}`,address:'춘천시',industry:'한식',coordinates:{lat,lng:127.73},
  }))
  const positions = buildPersistedPositions(stores)
  const sorted = sortByDistance(withDistances(stores,{lat:37.881,lng:127.73}))
  const nearby = filterStoresInBounds(sorted,positions,{south:37.879,north:37.882,west:127.72,east:127.74})
  assert.deepEqual(nearby.map(store=>store.id),[2,1])
  assert.equal(nearby[0].distanceMeters,0)
  const moved = filterStoresInBounds(sorted,positions,{south:37.899,north:37.901,west:127.72,east:127.74})
  assert.deepEqual(moved.map(store=>store.id),[3])
  assert.deepEqual(filterStoresInBounds(sorted,positions,{south:0,north:1,west:0,east:1}),[])
})
