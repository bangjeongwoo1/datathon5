import test from 'node:test'
import assert from 'node:assert/strict'
import { spokenConsent } from '../src/spokenConsent.ts'

test('길 안내 제안에 대한 자연스러운 짧은 동의와 거절을 구분한다', () => {
  for (const text of ['응', '네', '알았어', '알았다', '좋아요', '그래', '응, 안내해줘', '경로 안내해줘']) {
    assert.equal(spokenConsent(text), 'accept', text)
  }
  for (const text of ['아니요', '하지마', '안내하지마', '취소']) assert.equal(spokenConsent(text), 'decline', text)
  for (const text of ['알았어?', '응?', '알았다고 했잖아', '거기 음식은 얼마야?', '왜 안내 안 해?']) assert.equal(spokenConsent(text), null, text)
})

test('전화 제안 중 길 안내 요청을 발신 동의로 바꾸지 않는다', () => {
  assert.equal(spokenConsent('알았어', 'call'), 'accept')
  assert.equal(spokenConsent('길 안내해줘', 'call'), null)
  assert.equal(spokenConsent('응, 안내해줘', 'call'), null)
})
