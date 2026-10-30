
import { useRef, useState } from 'react'
type VoiceSearchProps = {
  onRecognized: (text: string) => void
  resultCount: number
}
export default function VoiceSearch({
  onRecognized,
  resultCount
}: VoiceSearchProps) {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const [recording, setRecording] = useState(false)
  const [loading, setLoading] = useState(false)
  const [recognizedText, setRecognizedText] = useState('')
  const [error, setError] = useState('')

  async function startRecording() {
    setError('')

    try {
      if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
        setError('이 브라우저에서는 음성 녹음을 지원하지 않습니다.')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })

      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        const audio = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        })

        const formData = new FormData()
        formData.append('audio', audio, 'recording.webm')

        setLoading(true)

        try {
          const response = await fetch('http://localhost:3001/api/stt', {
            method: 'POST',
            body: formData,
          })

          const data = await response.json()

          if (!response.ok) {
            throw new Error(data.error || '음성 인식 실패')
          }

          setRecognizedText(data.text)
          onRecognized(data.text)
        } catch (err) {
          setError(
            err instanceof Error ? err.message : '서버 연결 실패'
          )
        } finally {
          setLoading(false)
        }
      }

      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch {
      setError('마이크 사용 권한을 확인해 주세요.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setRecording(false)
  }

  
function speak() {
  if (!('speechSynthesis' in window)) {
    setError('이 브라우저는 음성 안내를 지원하지 않습니다.')
    return
  }

  window.speechSynthesis.cancel()

  let message = ''

  if (resultCount === 0) {
    message = '현재 등록된 가맹점 중 검색 결과가 없습니다.'
  } else {
    message = `현재 등록된 가맹점 중 ${resultCount}곳이 검색되었습니다.`
  }

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
