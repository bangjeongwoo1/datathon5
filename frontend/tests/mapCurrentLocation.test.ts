import assert from 'node:assert/strict'
import test from 'node:test'
import { moveMapToCurrentLocation } from '../src/mapCurrentLocation.ts'

test('현재 위치로 이동할 때 가까운 지도 확대 단계와 좌표를 적용한다', () => {
  const calls: unknown[] = []
  const map = {
    setLevel(level: number) { calls.push(['level', level]) },
    panTo(position: unknown) { calls.push(['pan', position]) },
  }
  class LatLng {
    lat: number
    lng: number

    constructor(lat: number, lng: number) {
      this.lat = lat
      this.lng = lng
    }
  }
  const maps = { LatLng }

  moveMapToCurrentLocation(map, maps, { lat: 37.88, lng: 127.73 })

  assert.deepEqual(calls[0], ['level', 3])
  assert.deepEqual(calls[1], ['pan', new LatLng(37.88, 127.73)])
})
