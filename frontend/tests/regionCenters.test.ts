import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DEFAULT_CENTER, REGION_CENTERS, getRegionCenter, nearestRegion, withIra } from '../src/regionCenters.ts'

test('내 위치와 가장 가까운 지역을 고른다', () => {
  assert.equal(nearestRegion({ lat: 37.6935, lng: 127.887 })?.region, '홍천군') // 홍천읍 (이번에 "춘천으로 뜨던" 곳)
  assert.equal(nearestRegion({ lat: 37.8813, lng: 127.73 })?.region, '춘천시') // 춘천시청
  assert.equal(nearestRegion({ lat: 37.3422, lng: 127.9202 })?.region, '원주시')
  assert.equal(nearestRegion({ lat: 37.7519, lng: 128.8761 })?.region, '강릉시')
  assert.equal(nearestRegion({ lat: 37.4916, lng: 127.9846 })?.region, '원주시') // 횡성: 원주가 가장 가깝다
})

test('모든 지역에서 40km 넘게 떨어져 있으면(예: 서울) 지역을 고르지 않는다', () => {
  assert.equal(nearestRegion({ lat: 37.5665, lng: 126.978 }), null)
  assert.equal(nearestRegion({ lat: 35.1796, lng: 129.0756 }), null) // 부산
})

test('기준 거리를 바꿀 수 있고, 돌려주는 거리는 그 지역 중심까지의 직선거리다', () => {
  const near = nearestRegion({ lat: 37.8813, lng: 127.73 })
  assert.ok(near && near.distanceMeters < 1)
  assert.equal(nearestRegion({ lat: 37.9, lng: 127.9 }, 1000), null) // 1km 안에는 없다
})

test('네 지역의 중심 좌표가 있고, 모르는 지역은 춘천시청을 쓴다', () => {
  assert.deepEqual(Object.keys(REGION_CENTERS).sort(), ['강릉시', '원주시', '춘천시', '홍천군'].sort())
  assert.deepEqual(getRegionCenter('홍천군'), REGION_CENTERS['홍천군'])
  assert.deepEqual(getRegionCenter('없는 지역'), DEFAULT_CENTER)
})

test('지역 이름 뒤 조사: 받침이 있으면 "이라", 없으면 "라"', () => {
  assert.equal(withIra('홍천군'), '홍천군이라')
  assert.equal(withIra('춘천시'), '춘천시라')
  assert.equal(withIra('원주시'), '원주시라')
  assert.equal(withIra('강릉시'), '강릉시라')
})

test('지도: 시작할 때 위치를 기다리지 않고, ◎ 는 "현재 위치로 이동"이며, 내 위치 이동이 지역 이동보다 나중에 일어난다', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const map = fs.readFileSync(path.join(root, 'src/KakaoMap.tsx'), 'utf8')
  assert.doesNotMatch(map, /requestCurrentLocation/, '지도를 띄울 때 위치 응답을 기다리면 안 된다')
  assert.match(map, /aria-label="현재 위치로 이동"/)
  assert.doesNotMatch(map, /선택 지역 중심으로 이동/)
  assert.match(map, /onClick=\{\(\) => onLocate\?\.\(\)\}/)

  // 같은 렌더에서 지역 중심 이동(effect)이 먼저, 내 위치 이동(effect)이 나중에 실행되어야 최종 위치가 내 위치가 된다.
  const regionEffect = map.indexOf('}, [ready, region, centerRequest])')
  const locateEffect = map.indexOf('}, [ready, locateTarget])')
  assert.ok(regionEffect > 0 && locateEffect > regionEffect, '내 위치 이동 effect 가 지역 이동 effect 뒤에 있어야 한다')
})

test('앱: 위치 권한이 이미 허용된 경우에만 열자마자 위치를 가져온다(처음 방문자에게 묻지도 않고 권한 창을 띄우지 않는다)', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /geolocationPermission\(\)/)
  assert.match(app, /state !== 'granted'/)
  assert.match(app, /onLocate=\{locateMe\}/)
})
