import test from 'node:test'
import assert from 'node:assert/strict'
import { navigationPosition, navigationLocationError, requestNavigationFix, watchNavigationFix } from '../src/guideLocation.ts'

const position = (change = {}) => ({
  timestamp: Date.now(),
  coords: { latitude: 37.88, longitude: 127.73, accuracy: 4 },
  ...change,
}) as GeolocationPosition

test('실시간 유효 좌표만 경로 안내에 전달한다', () => {
  assert.deepEqual(navigationPosition(position()), { lat: 37.88, lng: 127.73, accuracy: 4 })
  assert.throws(() => navigationPosition(position({ timestamp: Date.now() - 21000 })), /갱신되지/)
  assert.throws(() => navigationPosition(position({ timestamp: Date.now() + 10000 })), /갱신되지/)
  for (const coords of [
    { latitude: NaN, longitude: 127.73, accuracy: 4 },
    { latitude: 91, longitude: 127.73, accuracy: 4 },
    { latitude: 37.88, longitude: 181, accuracy: 4 },
    { latitude: 37.88, longitude: 127.73, accuracy: NaN },
    { latitude: 37.88, longitude: 127.73, accuracy: 0 },
  ]) assert.throws(() => navigationPosition(position({ coords })), /유효한 GPS/)
})

test('위치 권한·위치 미수신·시간 초과를 구분한다', () => {
  assert.match(navigationLocationError({ code: 1 }), /인터넷 앱·이 사이트의 위치 권한/)
  assert.match(navigationLocationError({ code: 2 }), /수신하지 못/)
  assert.match(navigationLocationError({ code: 3 }), /응답이 늦어/)
})

test('HTTPS와 위치 권한을 확인하고 최신 고정밀 위치를 요청한다', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: false } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  await assert.rejects(requestNavigationFix(), /HTTPS/)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } })
  await assert.rejects(requestNavigationFix(), /지원하지/)
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    getCurrentPosition(ok: PositionCallback, _fail: PositionErrorCallback, options: PositionOptions) {
      assert.deepEqual(options, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
      ok(position())
    },
  } } })
  assert.deepEqual(await requestNavigationFix(), { lat: 37.88, lng: 127.73, accuracy: 4 })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    getCurrentPosition(_ok: PositionCallback, fail: PositionErrorCallback) { fail({ code: 1 } as GeolocationPositionError) },
  } } })
  await assert.rejects(requestNavigationFix(), /위치 접근이 차단/)
})

test('GPS 추적 중 오류·오래된 좌표를 거르고 종료 뒤 늦은 이벤트를 무시한다', () => {
  let success!: PositionCallback, failure!: PositionErrorCallback
  const readings: unknown[] = [], errors: string[] = [], cleared: number[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: {
    watchPosition(ok: PositionCallback, fail: PositionErrorCallback, options: PositionOptions) {
      success = ok; failure = fail
      assert.deepEqual(options, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
      return 7
    },
    clearWatch(id: number) { cleared.push(id) },
  } } })
  const stop = watchNavigationFix(fix => readings.push(fix), message => errors.push(message))
  success(position())
  success(position({ timestamp: Date.now() - 30000 }))
  failure({ code: 2 } as GeolocationPositionError)
  assert.equal(readings.length, 1)
  assert.match(errors[0], /갱신되지/)
  assert.match(errors[1], /수신하지/)
  stop()
  success(position()); failure({ code: 1 } as GeolocationPositionError)
  assert.equal(readings.length, 1); assert.equal(errors.length, 2)
  assert.deepEqual(cleared, [7])
})
