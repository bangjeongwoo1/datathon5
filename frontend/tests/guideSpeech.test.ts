import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGuideSpeech } from '../src/guideSpeech.ts'

test('음성 모드 준비가 이전 답변 요청을 취소해 같은 플레이어를 덮어쓰지 않게 한다', async () => {
  const audioBefore = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const fetchBefore = globalThis.fetch
  const players: TestAudio[] = []
  let oldSignal: AbortSignal | undefined
  let finishOld: (response: Response) => void = () => {}

  class TestAudio {
    src = ''
    volume = 1
    muted = false
    constructor() { players.push(this) }
    play() { return Promise.resolve() }
    pause() {}
    removeAttribute(name: string) { if (name === 'src') this.src = '' }
  }

  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: TestAudio })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { speechSynthesis: { cancel() {} } },
  })
  globalThis.fetch = async (_url, options) => {
    oldSignal = options?.signal ?? undefined
    return new Promise(resolve => { finishOld = resolve })
  }
  try {
    const speech = createGuideSpeech(true)
    const previous = speech.speak('이전 검색 결과 안내')
    assert.equal(oldSignal?.aborted, false)
    assert.equal(await speech.unlock(), true)
    assert.equal(oldSignal?.aborted, true)
    finishOld(new Response(new Blob(['test-only'], { type: 'audio/mpeg' }), {
      headers: { 'content-type': 'audio/mpeg' },
    }))
    await previous
    assert.equal(players.length, 1)
    assert.ok(players[0].src.startsWith('data:audio/wav;base64,'))
    speech.stop()
  } finally {
    globalThis.fetch = fetchBefore
    if (audioBefore) Object.defineProperty(globalThis, 'Audio', audioBefore)
    else Reflect.deleteProperty(globalThis, 'Audio')
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})


test('Chirp 연결 실패 때 기기 기본 음성으로 바뀌지 않는다', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldFetch = globalThis.fetch
  let fallbackCalls = 0
  let error = ''
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    speechSynthesis: { cancel() {}, speak() { fallbackCalls++ } },
  } })
  globalThis.fetch = async () => new Response('', { status: 503 })
  try {
    const speech = createGuideSpeech(true, message => { error = message })
    await speech.speak('가게에 전화할까요?')
    assert.equal(fallbackCalls, 0)
    assert.match(error, /Chirp 3 HD/)
    speech.stop()
  } finally {
    globalThis.fetch = oldFetch
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
