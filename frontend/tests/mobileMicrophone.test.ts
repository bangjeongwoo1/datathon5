import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandsFree } from '../src/recordedHandsFree.ts'
import { createAudioRecorder, microphoneErrorMessage, recordingFileName } from '../src/microphone.ts'
import { combineVoiceSignals, voiceTimeoutSignal } from '../src/voiceTransport.ts'

async function mobileHarness(run: (h: ReturnType<typeof harness>) => Promise<void>, options: { context?: boolean; format?: string; reject?: string } = {}) {
  const h = harness(options)
  try { await run(h) } finally { h.cleanup() }
}

function harness(options: { context?: boolean; format?: string; reject?: string }) {
  const saved = new Map<string, PropertyDescriptor | undefined>()
  const intervals = new Map<number, () => void>()
  const deferred = new Map<number, { fn: () => void; delay: number }>()
  let serial = 0, level = 0, permissions = 0, stopped = 0, closed = 0, contexts = 0, resumes = 0
  const requests: { fileName: string; type: string; signal?: AbortSignal | null }[] = []
  const states: string[] = [], commands: string[] = []
  const recorders: Recorder[] = []
  const track = { onended: null as (() => void) | null, onmute: null as (() => void) | null, onunmute: null as (() => void) | null, stop() { stopped++ } }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  class Context {
    state = 'suspended'; constructor() { contexts++ }
    resume() { resumes++; this.state = 'running'; return Promise.resolve() }
    close() { closed++; this.state = 'closed'; return Promise.resolve() }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples: Float32Array) { samples.fill(level) } } }
    createMediaStreamSource() { return { connect() {} } }
  }
  class Recorder {
    state = 'inactive'; mimeType: string
    onstop: null | (() => void) = null
    ondataavailable: null | ((event: { data: Blob }) => void) = null
    onerror: null | (() => void) = null
    static isTypeSupported(type: string) { return type === (options.format ?? 'audio/webm;codecs=opus') }
    constructor(_stream: unknown, settings?: { mimeType: string }) { this.mimeType = settings?.mimeType ?? 'audio/webm'; recorders.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['synthetic audio'], { type: this.mimeType }) }); this.onstop?.() }
  }
  const values = {
    window: { isSecureContext: true, MediaRecorder: Recorder, AudioContext: options.context === false ? undefined : Context, addEventListener() {}, removeEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => { permissions++; if (options.reject) throw Object.assign(new Error('test'), { name: options.reject }); return stream } } },
    MediaRecorder: Recorder, localStorage: { setItem() {} },
    setInterval: (fn: () => void) => { const id = ++serial; intervals.set(id, fn); return id },
    clearInterval: (id: number) => intervals.delete(id),
    setTimeout: (fn: () => void, delay: number) => { const id = ++serial; deferred.set(id, { fn, delay }); return id },
    clearTimeout: (id: number) => deferred.delete(id),
    fetch: async (_url: unknown, request: RequestInit) => {
      const file = (request.body as FormData).get('audio') as File
      requests.push({ fileName: file.name, type: file.type, signal: request.signal })
      return { ok: true, json: async () => ({ text: '이따야 여기로 길 안내해줘' }) }
    },
  }
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const listener = createHandsFree(text => commands.push(text), (_enabled, message) => states.push(message))
  return {
    listener, track, requests, commands, states, recorders,
    stats: () => ({ permissions, stopped, closed, contexts, resumes }),
    async settle() { for (let i = 0; i < 30; i++) await Promise.resolve() },
    tick(rms: number, count: number) { level = rms; for (let i = 0; i < count; i++) for (const callback of [...intervals.values()]) callback() },
    async restart() {
      for (const [id, job] of [...deferred]) if (job.delay <= 150) { deferred.delete(id); job.fn() }
      for (let i = 0; i < 30; i++) await Promise.resolve()
    },
    cleanup() {
      listener.dispose()
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    },
  }
}

test('Android: 음성 답변과 AI 처리 중 마이크를 재허가하지 않고 같은 입력 연결로 재개한다', async () => {
  await mobileHarness(async h => {
    h.listener.start(); await h.settle()
    assert.equal(h.recorders[0].state, 'recording')
    h.listener.pause('speech', true)
    h.listener.pause('request', true)
    assert.equal(h.recorders[0].state, 'inactive')
    assert.equal(h.requests.length, 0)
    assert.deepEqual(h.stats(), { permissions: 1, stopped: 0, closed: 0, contexts: 1, resumes: 1 })
    h.listener.pause('speech', false); await h.restart()
    assert.equal(h.recorders.length, 1)
    h.listener.pause('request', false); await h.restart()
    assert.equal(h.recorders.length, 2)
    h.tick(0.005, 3); h.tick(0, 16); await h.settle()
    assert.deepEqual(h.commands, ['여기로 길 안내해줘'])
    assert.match(h.requests[0].type, /^audio\/webm/)
    assert.equal(h.stats().permissions, 1)
    h.listener.stop()
    assert.equal(h.stats().stopped, 1)
    assert.equal(h.stats().closed, 1)
  })
})

test('Web Audio가 없어도 MP4 지원 휴대폰에서 녹음·STT 전송이 동작한다', async () => {
  await mobileHarness(async h => {
    h.listener.start(); await h.settle()
    h.tick(0, 60); await h.settle()
    assert.equal(h.requests[0].fileName, 'command.mp4')
    assert.equal(h.requests[0].type, 'audio/mp4')
    assert.deepEqual(h.commands, ['여기로 길 안내해줘'])
    assert.equal(h.stats().contexts, 0)
  }, { context: false, format: 'audio/mp4' })
})

test('휴대폰 마이크가 통화로 음소거되면 녹음을 쉬고 해제 후 동일 스트림으로 재개한다', async () => {
  await mobileHarness(async h => {
    h.listener.start(); await h.settle()
    h.track.onmute?.(); h.tick(0.01, 70)
    assert.equal(h.requests.length, 0)
    assert.match(h.states.at(-1)!, /일시 중지/)
    h.track.onunmute?.(); await h.settle()
    assert.equal(h.recorders.at(-1)?.state, 'recording')
    assert.equal(h.stats().permissions, 1)
    h.listener.pause('speech', true)
    h.listener.stop(); h.listener.pause('speech', false); await h.restart()
    assert.equal(h.stats().permissions, 1)
  })
})

test('권한 거절과 다른 앱의 마이크 점유를 구분해 상태에 남긴다', async () => {
  for (const [reject, message] of [['NotAllowedError', /인터넷 앱.*사이트/], ['NotReadableError', /다른 앱|통화/]]) {
    await mobileHarness(async h => {
      h.listener.start(); await h.settle()
      assert.match(h.states.at(-1)!, message)
      assert.equal(h.recorders.length, 0)
    }, { reject })
  }
  assert.match(microphoneErrorMessage({ name: 'NotFoundError' }), /마이크를 찾지/)
  assert.equal(recordingFileName('audio/ogg;codecs=opus'), 'command.ogg')
})

test('브라우저 지원 형식을 선택하며 Android 인식기에서 사용할 수 있는 녹음 객체를 만든다', async () => {
  await mobileHarness(async () => {
    const recorder = createAudioRecorder({} as MediaStream)
    assert.equal(recorder.mimeType, 'audio/webm;codecs=opus')
  })
})

test('구형 Android의 AbortSignal.any/timeout 부재에서도 요청 취소와 제한 시간이 동작한다', () => {
  const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!
  const timer = globalThis.setTimeout
  let expire = () => {}
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined })
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined })
  globalThis.setTimeout = ((callback: () => void) => { expire = callback; return 1 }) as unknown as typeof setTimeout
  try {
    const parent = new AbortController()
    const deadline = voiceTimeoutSignal(15000)
    const signal = combineVoiceSignals([parent.signal, deadline])
    parent.abort('cancelled')
    assert.equal(signal.aborted, true)
    assert.equal(signal.reason, 'cancelled')
    const timed = combineVoiceSignals([voiceTimeoutSignal(15000)])
    expire()
    assert.equal(timed.aborted, true)
    assert.equal(timed.reason.name, 'TimeoutError')
  } finally {
    Object.defineProperty(AbortSignal, 'any', any)
    Object.defineProperty(AbortSignal, 'timeout', timeout)
    globalThis.setTimeout = timer
  }
})
