import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import {
  LocationError,
  geolocationPermission,
  locationErrorMessage,
  lowAccuracyNotice,
  requestCurrentLocation,
} from '../src/userLocation.ts'

type Position = { coords: { latitude: number; longitude: number; accuracy?: number } }
type Impl = (ok: (p: Position) => void, fail: (e: { code: number }) => void, options: PositionOptions) => void

function stubGeolocation(impl: Impl | null, extra: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: impl ? { geolocation: { getCurrentPosition: impl }, ...extra } : { ...extra },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

test('현재 위치 좌표를 위도와 경도로 반환한다', async () => {
  stubGeolocation(ok => ok({ coords: { latitude: 37.8813, longitude: 127.73 } }))
  assert.deepEqual(await requestCurrentLocation(), { lat: 37.8813, lng: 127.73 })
})

test('정확도(accuracy)가 있으면 함께 돌려준다', async () => {
  stubGeolocation(ok => ok({ coords: { latitude: 37.69, longitude: 127.88, accuracy: 40 } }))
  assert.deepEqual(await requestCurrentLocation(), { lat: 37.69, lng: 127.88, accuracy: 40 })
})

test('위치 기능이 없으면 안내 오류를 반환한다', async () => {
  stubGeolocation(null)
  await assert.rejects(requestCurrentLocation(), error => {
    assert.ok(error instanceof LocationError)
    assert.equal(error.reason, 'unsupported')
    assert.match(error.message, /현재 위치 기능을 지원하지 않습니다/)
    return true
  })
})

test('https 가 아닌 주소(IP 주소 등)에서는 이유를 알려 준다', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: false } })
  stubGeolocation(ok => ok({ coords: { latitude: 1, longitude: 1 } }))
  await assert.rejects(requestCurrentLocation(), error => {
    assert.ok(error instanceof LocationError)
    assert.equal(error.reason, 'insecure')
    assert.match(error.message, /https/)
    return true
  })
})

test('1차(빠른 방식)는 GPS 를 켜지 않고 최근 위치도 인정한다', async () => {
  const seen: PositionOptions[] = []
  stubGeolocation((ok, _fail, options) => {
    seen.push(options)
    ok({ coords: { latitude: 37.69, longitude: 127.88 } })
  })
  await requestCurrentLocation()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].enableHighAccuracy, false)
  assert.ok((seen[0].maximumAge ?? 0) > 0)
})

test('1차가 시간 초과·실패하면 GPS(정밀)로 한 번 더 시도해서 성공하면 그 값을 쓴다', async () => {
  for (const code of [3, 2]) {
    const order: boolean[] = []
    stubGeolocation((ok, fail, options) => {
      order.push(Boolean(options.enableHighAccuracy))
      if (!options.enableHighAccuracy) fail({ code })
      else ok({ coords: { latitude: 37.69, longitude: 127.88, accuracy: 25 } })
    })
    assert.deepEqual(await requestCurrentLocation(), { lat: 37.69, lng: 127.88, accuracy: 25 }, `code ${code}`)
    assert.deepEqual(order, [false, true], `code ${code}`)
  }
})

test('권한을 거부했으면 다시 묻지 않고 바로 "권한 거부" 안내를 낸다', async () => {
  let calls = 0
  stubGeolocation((_ok, fail) => {
    calls += 1
    fail({ code: 1 })
  })
  await assert.rejects(requestCurrentLocation(), error => error instanceof LocationError && error.reason === 'denied')
  assert.equal(calls, 1)
})

test('두 번 다 실패하면 마지막 실패 원인(시간 초과 / 위치 못 찾음)을 알려 준다', async () => {
  stubGeolocation((_ok, fail) => fail({ code: 3 }))
  await assert.rejects(requestCurrentLocation(), error => error instanceof LocationError && error.reason === 'timeout')

  stubGeolocation((_ok, fail) => fail({ code: 2 }))
  await assert.rejects(requestCurrentLocation(), error => error instanceof LocationError && error.reason === 'unavailable')

  stubGeolocation((_ok, fail) => fail({ code: 99 })) // 알 수 없는 오류도 "위치 못 찾음"으로 안내한다
  await assert.rejects(requestCurrentLocation(), error => error instanceof LocationError && error.reason === 'unavailable')
})

test('원인마다 사용자가 할 일이 담긴 서로 다른 안내 문구가 있다', () => {
  const reasons = ['unsupported', 'insecure', 'denied', 'unavailable', 'timeout'] as const
  const messages = reasons.map(locationErrorMessage)
  assert.equal(new Set(messages).size, reasons.length)
  assert.match(locationErrorMessage('denied'), /허용/)
  assert.match(locationErrorMessage('unavailable'), /GPS/)
  assert.match(locationErrorMessage('timeout'), /실외|창가/)
})

test('위치 권한 상태: 이미 허용됐는지 알려 주고, 조회를 못 하면 unknown(자동 요청 안 함)', async () => {
  stubGeolocation(null, { permissions: { query: async () => ({ state: 'granted' }) } })
  assert.equal(await geolocationPermission(), 'granted')

  stubGeolocation(null, { permissions: { query: async () => ({ state: 'prompt' }) } })
  assert.equal(await geolocationPermission(), 'prompt')

  stubGeolocation(null) // Permissions API 없음
  assert.equal(await geolocationPermission(), 'unknown')

  stubGeolocation(null, { permissions: { query: async () => { throw new Error('unsupported') } } })
  assert.equal(await geolocationPermission(), 'unknown')
})

test('정확도가 낮을 때만 안내한다(PC·실내에서 IP 나 와이파이로 추정한 위치)', () => {
  assert.equal(lowAccuracyNotice(undefined), null)
  assert.equal(lowAccuracyNotice(40), null)
  assert.equal(lowAccuracyNotice(3000), null)
  assert.match(lowAccuracyNotice(8200) ?? '', /약 8\.2km/)
  assert.equal(lowAccuracyNotice(Number.NaN), null)
})
