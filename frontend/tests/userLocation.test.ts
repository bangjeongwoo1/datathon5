import assert from 'node:assert/strict'
import test from 'node:test'
import { requestCurrentLocation } from '../src/userLocation.ts'

test('현재 위치 좌표를 위도와 경도로 반환한다', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(success: (position: { coords: { latitude: number; longitude: number } }) => void) {
          success({ coords: { latitude: 37.8813, longitude: 127.73 } })
        },
      },
    },
  })

  await assert.doesNotReject(async () => {
    assert.deepEqual(await requestCurrentLocation(), { lat: 37.8813, lng: 127.73 })
  })
})

test('위치 기능이 없으면 안내 오류를 반환한다', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })

  await assert.rejects(requestCurrentLocation(), /현재 위치 기능을 지원하지 않습니다/)
})
