import test from 'node:test'
import assert from 'node:assert/strict'
import { recommendationSpeech } from '../src/recommendationSpeech.ts'

test('실제 AI 설명 뒤에 길 안내 동의 질문을 붙인다', () => {
  assert.equal(recommendationSpeech('등록된 국밥은 8,000원이에요.', '조회 식당'),
    '등록된 국밥은 8,000원이에요. 조회 식당까지 길 안내할까요?')
})

test('긴 설명과 가게명을 함께 읽어도 TTS 400자 제한과 마지막 질문을 유지한다', () => {
  const name = '긴가게이름'.repeat(20)
  const result = recommendationSpeech('국밥은 등록 기준 8,000원이에요. ' + '방문 전에 메뉴를 확인해 주세요. '.repeat(25), name)
  assert.ok(result.length <= 400)
  assert.ok(result.startsWith('국밥은 등록 기준 8,000원이에요.'))
  assert.ok(result.endsWith(`${name}까지 길 안내할까요?`))
})

test('문장 경계가 없거나 상호가 지나치게 길어도 안내 질문이 사라지지 않는다', () => {
  const result = recommendationSpeech('설명'.repeat(250), '상호'.repeat(100))
  assert.ok(result.length <= 400)
  assert.ok(result.endsWith('이 식당까지 길 안내할까요?'))
})
