import assert from 'node:assert/strict'
import test from 'node:test'
import { straightDistanceMeters, withDistances, sortByDistance, formatStraightDistance } from '../src/merchantDistance.ts'

test('위도 1도 거리는 약 111km이고 같은 위치는 0m다', () => {
  assert.equal(straightDistanceMeters({lat:37,lng:127},{lat:37,lng:127}),0)
  assert.ok(Math.abs(straightDistanceMeters({lat:37,lng:127},{lat:38,lng:127})-111195)<2)
})

test('GPS 기준으로 정렬하고 좌표 없는 매장은 마지막에 두며 원본 순서를 보존한다', () => {
  const stores = [{id:1,coordinates:{lat:38,lng:127}},{id:2},{id:3,coordinates:{lat:37,lng:127}}]
  const measured = withDistances(stores,{lat:37,lng:127})
  assert.deepEqual(sortByDistance(measured).map(s=>s.id),[3,1,2])
  assert.deepEqual(stores.map(s=>s.id),[1,2,3])
  assert.equal(measured[1].distanceMeters,null)
  assert.ok(withDistances(stores,null).every(s=>s.distanceMeters===null))
})

test('미터와 킬로미터를 직선거리로 구분해 안내한다', () => {
  assert.equal(formatStraightDistance(321.3),'직선거리 321m')
  assert.equal(formatStraightDistance(1250),'직선거리 1.3km')
})
