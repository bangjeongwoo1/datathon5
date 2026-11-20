import { apiUrl } from './apiUrl.ts'

export function createGuideSpeech(
  useCloud = import.meta.env?.VITE_GUIDE_GOOGLE_TTS !== 'false',
  reportError: (message: string) => void = () => {},
  onSpeaking: (speaking: boolean) => void = () => {},
  onPlayback: (message: string) => void = () => {},
) {
  let controller: AbortController | undefined
  let audio: HTMLAudioElement | undefined
  let playback: HTMLAudioElement | undefined
  let objectUrl: string | undefined
  let lastAudio: { text: string; blob: Blob } | undefined
  let utterance: SpeechSynthesisUtterance | undefined

  function attach(host: HTMLDivElement | null) {
    if (!host) return
    playback ??= new Audio()
    playback.controls = true
    playback.preload = 'auto'
    playback.setAttribute('aria-label', '마지막 음성 답변 재생')
    if (!playback.getAttribute('src')) playback.hidden = true
    if (playback.parentElement !== host) host.appendChild(playback)
  }

  // Start this same audio element during the user's click so that replies
  // arriving after STT/network requests can play on gesture-gated browsers.
  async function unlock() {
    stop()
    reportError('')
    const wav = new Uint8Array(1644)
    const view = new DataView(wav.buffer)
    const write = (at: number, value: string) => {
      for (let i = 0; i < value.length; i++) wav[at + i] = value.charCodeAt(i)
    }
    write(0, 'RIFF'); view.setUint32(4, 1636, true); write(8, 'WAVE')
    write(12, 'fmt '); view.setUint32(16, 16, true)
    view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true)
    view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    write(36, 'data'); view.setUint32(40, 1600, true)
    playback ??= new Audio()
    playback.muted = false
    playback.volume = 1
    playback.onplaying = playback.onpause = playback.onended = playback.onerror = null
    playback.src = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...wav))
    try {
      await playback.play()
      reportError('')
      return true
    } catch {
      reportError('소리 재생이 허용되지 않았어요. 브라우저 사이트 설정에서 소리를 허용하고 음성 모드를 다시 켜 주세요.')
      return false
    }
  }

  function releaseAudio() {
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.onplaying = null
      audio.onpause = null
      audio.pause()
      audio.removeAttribute('src')
      audio = undefined
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
  }

  function stop() {
    controller?.abort()
    controller = undefined
    releaseAudio()
    window.speechSynthesis?.cancel()
    utterance = undefined
    onSpeaking(false)
  }

  async function speak(text: string) {
    stop()
    reportError('')
    const request = new AbortController()
    controller = request
    onSpeaking(true)
    onPlayback('음성 답변을 준비하고 있어요.')
    let fallbackStarted = false

    function fallback() {
      if (request.signal.aborted || fallbackStarted) return
      fallbackStarted = true
      if (useCloud) {
        onSpeaking(false)
        onPlayback('잇다 음성을 불러오지 못했어요. 같은 목소리로 다시 듣기를 눌러 주세요.')
        reportError('Chirp 3 HD 음성 연결을 확인해 주세요. 다른 목소리로 자동 전환하지 않습니다.')
        return
      }
      const synthesis = window.speechSynthesis
      if (!synthesis) {
        onSpeaking(false)
        reportError('이 브라우저에서 음성 재생을 지원하지 않아요.')
        return
      }
      const speech = new SpeechSynthesisUtterance(text)
      speech.lang = 'ko-KR'
      const koreanVoice = synthesis.getVoices?.().find(voice => /^ko(?:[-_]|$)/i.test(voice.lang))
      if (koreanVoice) speech.voice = koreanVoice
      speech.onend = () => {
        if (utterance === speech) {
          utterance = undefined
          onSpeaking(false)
          onPlayback('기기 음성 재생을 마쳤어요.')
        }
      }
      speech.onerror = event => {
        if (request.signal.aborted) return
        utterance = undefined
        onSpeaking(false)
        onPlayback('기기에서 음성 재생을 시작하지 못했어요.')
        reportError(`브라우저 음성 재생 오류 (${event.error}). Chrome 또는 Edge에서도 다시 듣기를 눌러 주세요.`)
      }
      utterance = speech
      speech.onstart = () => {
        if (!request.signal.aborted) onPlayback('기기 음성으로 답변을 재생하고 있어요.')
      }
      synthesis.resume?.()
      synthesis.speak(utterance)
    }

    if (!useCloud) return fallback()
    try {
      let blob = lastAudio?.text === text ? lastAudio.blob : undefined
      if (!blob) {
        const response = await fetch(apiUrl('/api/guide-speech'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/mpeg')) {
          throw new Error('Cloud speech unavailable')
        }
        blob = await response.blob()
      }
      if (request.signal.aborted) return
      lastAudio = { text, blob }
      objectUrl = URL.createObjectURL(blob)
      const player = playback ??= new Audio()
      player.src = objectUrl
      player.hidden = false
      player.muted = false
      player.volume = 1
      audio = player
      player.onplaying = () => {
        if (audio !== player || request.signal.aborted) return
        reportError('')
        onSpeaking(true)
        onPlayback('음성 답변을 재생하고 있어요.')
      }
      player.onpause = () => {
        if (audio === player && player.paused && !player.ended) {
          onSpeaking(false)
          onPlayback('음성이 일시 정지됐어요. 재생 버튼으로 다시 들을 수 있어요.')
        }
      }
      player.onended = () => {
        if (audio === player) {
          onSpeaking(false)
          onPlayback('음성 답변을 마쳤어요. 재생 버튼으로 다시 들을 수 있어요.')
        }
      }
      player.onerror = () => {
        if (audio === player) {
          releaseAudio()
          fallback()
        }
      }
      try {
        await player.play()
      } catch (error) {
        if (request.signal.aborted) return
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          onSpeaking(false)
          onPlayback('브라우저가 자동 재생을 막았어요. 아래 음성 재생 버튼을 눌러 주세요.')
          reportError('아래 음성 플레이어에서 재생을 눌러 주세요.')
          return
        }
        throw error
      }
    } catch {
      if (request.signal.aborted || controller !== request) return
      releaseAudio()
      fallback()
    }
  }

  return { speak, stop, unlock, attach, isActive: () => Boolean(controller && !controller.signal.aborted) }
}
