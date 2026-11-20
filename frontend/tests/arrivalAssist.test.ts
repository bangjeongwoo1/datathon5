import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateArrival, estimateRouteEnd, merchantCallUrl, arrivalCommand, helpCallScript, requestMerchantCall } from '../src/arrivalAssist.ts'

const point = { lat: 37.88, lng: 127.73 }
test('2m 좌표 근접에도 위치 오차가 크면 초근접으로 판정하지 않는다', () => {
  assert.equal(estimateArrival({ ...point, accuracy: 1 }, point, 1).proximity, 'very-close')
  assert.equal(estimateArrival({ ...point, accuracy: 10 }, point, 1).proximity, 'nearby')
  assert.equal(estimateArrival({ ...point, accuracy: 30 }, point, 1).proximity, 'uncertain')
})
test('경로가 남았거나 목적지에서 멀면 근처 도착으로 판정하지 않는다', () => {
  assert.equal(estimateArrival({ ...point, accuracy: 1 }, point, 16).proximity, 'outside')
  assert.equal(estimateArrival({ ...point, lat: point.lat + 0.001, accuracy: 1 }, point, 1).proximity, 'outside')
  assert.equal(estimateArrival({ ...point, accuracy: NaN }, point, 0).proximity, 'outside')
  assert.equal(estimateArrival({ ...point, accuracy: 0 }, point, 0).proximity, 'outside')
})
test('전화번호가 없거나 변조된 링크면 전화 링크를 만들지 않는다', () => {
  assert.equal(merchantCallUrl(), null)
  assert.equal(merchantCallUrl('전화번호 없음'), null)
  assert.equal(merchantCallUrl('javascript:123456789'), null)
  assert.equal(merchantCallUrl('033-123-4567'), 'tel:0331234567')
  assert.equal(merchantCallUrl('+82 (33) 123-4567'), 'tel:+82331234567')
})
test('짧은 동의는 전화 도움을 제안한 맥락에서만 처리한다', () => {
  assert.equal(arrivalCommand('네', false), null)
  assert.equal(arrivalCommand('네', true), 'accept-call')
  assert.equal(arrivalCommand('아니요', true), 'decline-call')
  assert.equal(arrivalCommand('전화하지 마', true), 'decline-call')
  assert.equal(arrivalCommand('입구를 모르겠어', false), 'help')
  assert.equal(arrivalCommand('식당 찾는 걸 도와줘', false), null)
  assert.equal(arrivalCommand('입구 찾았어', false), 'confirm')
  assert.equal(arrivalCommand('입구 찾았어?', false), null)
  assert.equal(arrivalCommand('여기가 입구야?', false), null)
})
test('도움 요청문에 확인되지 않은 장애나 좌표를 넣지 않는다', () => {
  const script = helpCallScript('테스트 식당')
  assert.ok(script.includes('테스트 식당'))
  assert.ok(script.includes('입구'))
  assert.ok(!script.includes('시각장애'))
  assert.ok(!script.includes('GPS'))
})

test('음성 동의 문맥에서만 DB 번호로 연결을 요청하며 실제 통화로 단정하지 않는다', () => {
  const requested: string[] = []
  const open = (url: string) => { requested.push(url) }
  assert.equal(arrivalCommand('응', true), 'accept-call')
  assert.equal(requestMerchantCall('033-123-4567', open), 'requested')
  assert.deepEqual(requested, ['tel:0331234567'])
  assert.equal(requestMerchantCall(undefined, open), 'unavailable')
  assert.equal(requested.length, 1)
  assert.equal(requestMerchantCall('033-123-4567', () => { throw new Error('blocked') }), 'unavailable')
})

test('가게 핀과 보행 경로 끝이 달라도 경로 끝에서는 전화 도움을 제안할 수 있다', () => {
  const merchantPin = { ...point, lat: point.lat + 0.001 }
  assert.equal(estimateArrival({ ...point, accuracy: 5 }, merchantPin, 0).proximity, 'outside')
  assert.equal(estimateRouteEnd({ ...point, accuracy: 5 }, point, 0)?.proximity, 'nearby')
  assert.equal(estimateRouteEnd({ ...point, accuracy: 5 }, undefined, 0), null)
  assert.equal(estimateRouteEnd({ ...point, accuracy: 5 }, point, 20), null)
  assert.equal(arrivalCommand('알았어', true), 'accept-call')
  assert.equal(arrivalCommand('응, 전화 연결해줘', true), 'accept-call')
  assert.equal(arrivalCommand('알았어', false), null)
  assert.equal(arrivalCommand('길 안내해줘', true), null)
})
