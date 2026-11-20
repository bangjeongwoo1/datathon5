import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandsFree } from '../src/recordedHandsFree.ts'

test('automatic wake listening survives suspended audio and a transient STT failure', async () => {
  const values: Record<string, unknown> = {}
  const saved = new Map<string, PropertyDescriptor | undefined>()
  let tick = () => {}
  let retry = () => {}
  let requests = 0
  let recordings = 0
  const states: boolean[] = []
  const commands: string[] = []
  class Context {
    state = 'suspended'
    resume() { return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData() {} } }
    createMediaStreamSource() { return { connect() {} } }
  }
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm'
    onstop: null | (() => void) = null
    ondataavailable: null | ((event: { data: Blob }) => void) = null
    start() { recordings++; this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() }
  }
  Object.assign(values, {
    window: { MediaRecorder: Recorder, AudioContext: Context, addEventListener() {}, removeEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    AudioContext: Context, MediaRecorder: Recorder, localStorage: { setItem() {} },
    setInterval: (fn: () => void) => { tick = fn; return 1 }, clearInterval() {},
    setTimeout: (fn: () => void) => { retry = fn; return 1 }, clearTimeout() {},
    fetch: async () => {
      requests++
      if (requests === 1) throw new Error('temporary outage')
      return { ok: true, json: async () => ({ text: '잇다야 근처 식당 찾아줘' }) }
    },
  })
  let listener: ReturnType<typeof createHandsFree> | undefined
  const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
  try {
    for (const [key, value] of Object.entries(values)) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    }
    listener = createHandsFree(text => commands.push(text), enabled => states.push(enabled))
    listener.start()
    await settle()
    for (let i = 0; i < 60; i++) tick()
    await settle()
    assert.equal(requests, 1)
    assert.ok(!states.includes(false))
    retry(); await settle()
    assert.equal(recordings, 2)
    for (let i = 0; i < 60; i++) tick()
    await settle()
    assert.deepEqual(commands, ['근처 식당 찾아줘'])
    assert.ok(!states.includes(false))
  } finally {
    listener?.dispose()
    for (const key of Object.keys(values)) {
      const descriptor = saved.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
