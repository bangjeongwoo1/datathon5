import test from 'node:test'
import assert from 'node:assert/strict'
import { createVoiceActivity } from '../src/voiceActivity.ts'

test('기존 0.008보다 작은 목소리를 연속 감지하고 문장 중 짧은 쉼은 기다린다', () => {
  const activity = createVoiceActivity()
  assert.equal(activity.sample(0.005).hasSpeech, false)
  assert.equal(activity.sample(0.005).justStarted, true)
  for (let i = 0; i < 13; i++) assert.equal(activity.sample(0).shouldStop, false)
  assert.equal(activity.sample(0.005).shouldStop, false)
  for (let i = 0; i < 15; i++) assert.equal(activity.sample(0).shouldStop, false)
  assert.equal(activity.sample(0).shouldStop, true)
})

test('작은 배경음과 한 프레임 충격음은 발화로 제출하지 않는다', () => {
  const activity = createVoiceActivity()
  for (let i = 0; i < 149; i++) {
    const frame = activity.sample(i === 20 ? 0.1 : 0.001)
    assert.equal(frame.hasSpeech, false)
    assert.equal(frame.shouldStop, false)
  }
  assert.deepEqual(activity.sample(0), { justStarted: false, shouldStop: true, hasSpeech: false })
})

test('지속 발화도 녹음 상한에서 제출하고 새 녹음에는 이전 발화를 남기지 않는다', () => {
  const activity = createVoiceActivity()
  for (let i = 0; i < 149; i++) assert.equal(activity.sample(0.006).shouldStop, false)
  assert.equal(activity.sample(0.006).shouldStop, true)
  assert.equal(createVoiceActivity().sample(0).hasSpeech, false)
})
