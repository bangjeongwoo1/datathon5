
import { useEffect, useRef, useState } from 'react'
import { apiUrl } from './apiUrl'
import { createAudioRecorder, microphoneAvailabilityError, microphoneErrorMessage, recordingFileName } from './microphone'
import { combineVoiceSignals, voiceTimeoutSignal } from './voiceTransport'
type VoiceSearchProps = {
  onRecognized: (text: string) => void
  onRecordingChange?: (value: boolean) => void
  resultCount: number
}
export default function VoiceSearch({
  onRecognized,
  onRecordingChange,
  resultCount
}: VoiceSearchProps) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const requestRef = useRef<AbortController | null>(null)

  const [recording, setRecording] = useState(false)
  const [loading, setLoading] = useState(false)
  const [recognizedText, setRecognizedText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => () => {
    requestRef.current?.abort()
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') {
      recorder.onstop = null
      recorder.stop()
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  async function startRecording() {
    setError('')

    try {
      const unavailable = microphoneAvailabilityError()
      if (unavailable) {
        setError(unavailable)
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      streamRef.current = stream
      chunksRef.current = []

      const recorder = createAudioRecorder(stream)
      recorder.onerror = () => {
        recorder.onstop = null
        if (recorder.state === 'recording') recorder.stop()
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setRecording(false)
        setLoading(false)
        onRecordingChange?.(false)
        setError('휴대폰에서 녹음이 중단됐어요. 마이크를 다시 연결해 주세요.')
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        setRecording(false)
        onRecordingChange?.(false)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        const audio = new Blob(chunksRef.current, {
          type: recorder.mimeType || chunksRef.current.find(chunk => chunk.type)?.type || '',
        })

        if (!audio.size) {
          setError('녹음된 소리가 없어요. 마이크 권한과 휴대폰의 마이크 접근 설정을 확인해 주세요.')
          return
        }

        const formData = new FormData()
        formData.append('audio', audio, recordingFileName(audio.type))

        setLoading(true)
        const request = new AbortController()
        requestRef.current = request

        try {
          const response = await fetch(apiUrl('/api/stt'), {
            method: 'POST',
            body: formData,
            signal: combineVoiceSignals([request.signal, voiceTimeoutSignal(15000)]),
          })

          const data = await response.json()
          if (request.signal.aborted) return

          if (!response.ok) {
            throw new Error(data.error || '음성 인식 실패')
          }

          setRecognizedText(data.text)
          onRecognized(data.text)
        } catch (err) {
          if (request.signal.aborted) return
          setError(
            err instanceof Error ? err.message : '서버 연결 실패'
          )
        } finally {
          setLoading(false)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      onRecordingChange?.(true)
      setRecording(true)
    } catch (error) {
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setRecording(false)
      onRecordingChange?.(false)
      setError(microphoneErrorMessage(error))
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    onRecordingChange?.(false)
    setRecording(false)
  }


function speak() {
  if (!('speechSynthesis' in window)) {
    setError('이 브라우저는 음성 안내를 지원하지 않습니다.')
    return
  }

  window.speechSynthesis.cancel()


const message =
  resultCount === 0
    ? '현재 등록된 가맹점 중 검색 결과가 없습니다.'
    : `현재 등록된 가맹점 중 ${resultCount}곳이 검색되었습니다.`


  const speech = new SpeechSynthesisUtterance(message)
  speech.lang = 'ko-KR'
  speech.rate = 0.95

  window.speechSynthesis.speak(speech)
}


  return (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <button
        type="button"
        disabled={loading}
        onClick={recording ? stopRecording : startRecording}
      >
        {loading
          ? '음성 인식 중...'
          : recording
          ? '⏹ 녹음 종료'
          : '🎤 음성으로 검색'}
      </button>

      {recording && <p>말씀하신 뒤 녹음 종료를 눌러주세요.</p>}

      {recognizedText && (
        <div>
          <p>인식 결과: {recognizedText}</p>
          <button type="button" onClick={speak}>
            🔊 검색 결과 듣기
          </button>
        </div>
      )}

      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
