import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activateVoice, guideSelection, normalizeVoiceCommand } from '../src/voiceActivation.ts'

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

test('이따야·잇따야 호출과 자연스러운 길 안내 요청을 같은 목적지 선택으로 받는다', () => {
  for (const wake of ['잇다야', '잇따야', '이따야', '이따 야', '안녕 이따야']) {
    for (const request of ['여기로 안내해줘', '여기로 길 안내해 줘', '여기로 안내를 해 주세요', '이 식당으로 안내해줄래?', '여기로 길 안내 시작해줘요', '이쪽으로 데려다줘']) {
      const spoken = `${wake}, ${request}`
      const activated = activateVoice(spoken, false)
      assert.ok(activated, spoken)
      assert.equal(guideSelection(activated.command), 'current', spoken)
      assert.equal(guideSelection(spoken), 'current', spoken)
    }
  }
  assert.equal(normalizeVoiceCommand('“이따야”: 여기로 안내해줘.'), '여기로 안내해줘.')
  assert.equal(guideSelection('이따야 두 번째 식당으로 길 안내해줄래'), 1)
})

test('부정·가정·주변 대화를 목적지 선택 명령으로 확대하지 않는다', () => {
  for (const spoken of ['여기로 안내하지 마', '여기로 안내 안 해줘도 돼', '여기로 안내해주면 좋겠다고 했어', '여기로 안내하는 거야', '식당에 갔다 왔어', '네', '응', '이따야 전화해줘']) {
    assert.equal(guideSelection(spoken), null, spoken)
  }
  assert.equal(activateVoice('여기로 길 안내해줘', false), null)
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
