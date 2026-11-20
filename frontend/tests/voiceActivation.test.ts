import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activateVoice, guideSelection } from '../src/voiceActivation.ts'

test('호출어와 안내 선택 표현을 연결하며 인사 뒤의 야를 명령에 남기지 않는다', () => {
  for (const spoken of ['잇다야 여기로 안내', '안녕 잇다야 여기로 안내', '안녕 잇다, 여기로 안내', '이따야 여기로 안내']) {
    const request = activateVoice(spoken, false)
    assert.ok(request, spoken)
    assert.equal(guideSelection(request.command), 'current')
  }
  for (const spoken of ['잇다야 첫 번째로 안내해 줘', '잇다야 첫 번째로 안내해 주세요', '잇다야 1번으로 안내']) {
    const request = activateVoice(spoken, false)
    assert.ok(request, spoken)
    assert.equal(guideSelection(request.command), 0)
  }
})

test('호출어 없는 주변 대화와 STT의 감사 문장은 선택 명령으로 실행하지 않는다', () => {
  for (const spoken of ['감사합니다.', '여기로 안내', '오늘 식당 갔다 왔어']) {
    assert.equal(activateVoice(spoken, false), null, spoken)
  }
  assert.equal(guideSelection(activateVoice('여기로 안내', true)!.command), 'current')
})


test('호출 뒤 자연스러운 표현을 AI 해석으로 전달하고 후속 대화를 받는다', () => {
  assert.equal(activateVoice('잇다야 배고픈데 따뜻한 밥 먹고 싶어', false)?.command, '배고픈데 따뜻한 밥 먹고 싶어')
  assert.equal(activateVoice('그중에서 제일 가까운 곳이 어디야', true)?.command, '그중에서 제일 가까운 곳이 어디야')
  assert.equal(activateVoice('그중에서 제일 가까운 곳이 어디야', false), null)
})
