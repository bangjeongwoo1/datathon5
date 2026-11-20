import { apiUrl } from './apiUrl.ts'
import { activateVoice, findVoiceWake } from './voiceActivation.ts'
import { createVoiceActivity } from './voiceActivity.ts'

export function createHandsFree(
  onCommand: (text: string) => void,
  onState: (enabled: boolean, message: string) => void,
  onHeard: (text: string, accepted: boolean) => void = () => {},
) {
  let enabled = false
  let generation = 0
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let recorder: MediaRecorder | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let restart: ReturnType<typeof setTimeout> | undefined
  let request: AbortController | undefined
  const pauses = new Set<string>()
  let conversationUntil = 0
  let opening = false
  let lastCommand = ''
  let lastCommandAt = 0
  const owner = Math.random().toString(36).slice(2)
  const ownershipKey = 'eatda-voice-owner'

  function ownershipChanged(event: StorageEvent) {
    if (event.key === ownershipKey && event.newValue !== owner) {
      stop('다른 잇다 탭에서 음성 모드를 시작해 이 탭은 껐어요.')
    }
  }

  function clear() {
    generation++
    opening = false
    clearInterval(timer)
    clearTimeout(restart)
    request?.abort()
    request = undefined
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      if (recorder.state === 'recording') recorder.stop()
      recorder = undefined
    }
    stream?.getTracks().forEach(track => track.stop())
    stream = undefined
    if (context && context.state !== 'closed') void context.close().catch(() => {})
    context = undefined
  }

  function stop(message = '음성 모드를 껐어요.') {
    enabled = false
    clear()
    window.removeEventListener('storage', ownershipChanged)
    onState(false, message)
  }

  async function listen() {
    if (!enabled || pauses.size || stream || opening) return
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext) {
      stop('이 브라우저에서 자동 녹음을 사용할 수 없어요. Chrome이나 Edge에서 열어 주세요.')
      return
    }
    const current = generation
    opening = true
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (!enabled || pauses.size || current !== generation) {
        microphone.getTracks().forEach(track => track.stop())
        return
      }
      stream = microphone
      opening = false
      const audioContext = new AudioContext()
      context = audioContext
      if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {})
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      audioContext.createMediaStreamSource(microphone).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      let voiced = 0
      let frames = 0
      let processing = false
      let chunks: Blob[] = []
      let discard = false
      let timedCapture = false
      let failures = 0
      let activity = createVoiceActivity()

      async function transcribe(blob: Blob) {
        if (current !== generation) return
        onState(true, '말씀을 확인하고 있어요.')
        request = new AbortController()
        try {
          const body = new FormData()
          body.append('audio', blob, blob.type.includes('mp4') ? 'command.mp4' : 'command.webm')
          const response = await fetch(apiUrl('/api/stt'), {
            method: 'POST', body,
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
          })
          const result = await response.json() as { text?: string; error?: string }
          if (current !== generation) return
          if (!response.ok) throw new Error(result.error || '음성 인식 서버 오류')
          failures = 0
          const activated = activateVoice(result.text ?? '', Date.now() < conversationUntil)
          onHeard(result.text?.trim() ?? '', Boolean(activated))
          if (activated) {
            conversationUntil = Date.now() + 15000
            const normalized = activated.command.replace(/[\s,.!?]/g, '')
            if (normalized !== lastCommand || Date.now() - lastCommandAt > 1800) {
              lastCommand = normalized
              lastCommandAt = Date.now()
              onCommand(activated.command)
            }
          } else if (findVoiceWake(result.text ?? '').wake) {
            conversationUntil = Date.now() + 15000
            onCommand('음성 요청 도움말')
          }
        } catch {
          if (current === generation) {
            failures++
            onState(true, '음성 연결을 다시 시도하고 있어요. 마이크 대기는 유지됩니다.')
          }
        } finally {
          if (current === generation) {
            processing = false
            voiced = 0
            frames = 0
            if (enabled && !pauses.size) onState(true,
              Date.now() < conversationUntil ? '요청 한 가지를 말씀하세요.' : '“잇다야” 또는 “이따야”라고 불러 주세요.')
            if (enabled && !pauses.size) {
              clearTimeout(restart)
              restart = setTimeout(() => {
                if (current === generation && enabled && !pauses.size) beginRecording()
              }, failures ? Math.min(1000 * 2 ** Math.min(failures, 4), 15000) : 0)
            }
          }
        }
      }

      function beginRecording() {
        chunks = []
        voiced = 0
        frames = 0
        discard = false
        timedCapture = audioContext.state !== 'running'
        activity = createVoiceActivity()
        const capture = new MediaRecorder(microphone)
        recorder = capture
        capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
        capture.onerror = () => {
          if (current === generation) stop('마이크 녹음이 중단됐어요. 다시 켜 주세요.')
        }
        capture.onstop = () => {
          recorder = undefined
          if (current !== generation) return
          const blob = new Blob(chunks, { type: capture.mimeType })
          chunks = []
          if (discard || (!timedCapture && voiced < 2) || !blob.size) {
            processing = false
            voiced = 0
            frames = 0
            if (enabled && !pauses.size) beginRecording()
            return
          }
          void transcribe(blob)
        }
        capture.start()
        onState(true, Date.now() < conversationUntil
          ? '마이크가 준비됐어요. 요청 한 가지를 말씀하세요.'
          : '마이크가 준비됐어요. “잇다야”라고 불러 주세요.')
      }

      beginRecording()
      timer = setInterval(() => {
        if (current !== generation || processing) return
        if (audioContext.state !== 'running') {
          // MediaRecorder works even when autoplay policy suspends Web Audio.
          // Keep wake-word listening through bounded recordings without a button.
          timedCapture = true
          if (++frames >= 60 && recorder?.state === 'recording') {
            processing = true
            recorder.stop()
          }
          return
        }
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
        const frame = activity.sample(rms)
        if (frame.hasSpeech) voiced = 2
        if (frame.justStarted) onState(true, '말씀을 듣고 있어요.')
        if (recorder && frame.shouldStop) {
          processing = true
          discard = !frame.hasSpeech
          recorder.stop()
        }
      }, 100)
    } catch {
      if (current === generation) stop('마이크를 열지 못했어요. 주소창의 마이크 권한을 허용해 주세요.')
    }
  }

  return {
    setHandler(handler: (text: string) => void) { onCommand = handler },
    start() {
      enabled = true
      conversationUntil = 0
      lastCommand = ''
      window.addEventListener('storage', ownershipChanged)
      try { localStorage.setItem(ownershipKey, owner) } catch { /* Storage can be disabled. */ }
      clear()
      void listen()
      return enabled
    },
    stop,
    requestCommand() {
      conversationUntil = Date.now() + 15000
      if (enabled && !pauses.size) {
        clear()
        void listen()
      }
    },
    pause(reason: string, paused: boolean) {
      if (paused) {
        pauses.add(reason)
        clear()
        if (enabled) onState(true, '안내가 끝나면 다시 들을게요.')
      } else {
        const wasPaused = pauses.delete(reason)
        if (wasPaused && reason === 'speech' && conversationUntil > 0) conversationUntil = Date.now() + 15000
        if (enabled && !pauses.size) {
          clearTimeout(restart)
          restart = setTimeout(() => { void listen() }, 150)
        }
      }
    },
    dispose() {
      enabled = false
      clear()
      window.removeEventListener('storage', ownershipChanged)
    },
  }
}
