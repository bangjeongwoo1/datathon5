
import { useEffect, useState } from 'react'
import type { Merchant } from './merchants'
import { apiUrl } from './apiUrl'

type Props = {
  stores: Merchant[]
  trigger: number
}

type WalkingResult = {
  nearest: {
    id: number
    name: string
    address: string
    meters: number
  }
  total: number
  compared: number
  attempted: number
}

export default function NearestVoice({ stores, trigger }: Props) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  function speak(text: string) {
    if (!('speechSynthesis' in window)) return

    window.speechSynthesis.cancel()

    const speech = new SpeechSynthesisUtterance(text)
    speech.lang = 'ko-KR'
    speech.rate = 0.9

    window.speechSynthesis.speak(speech)
  }

  function announce(text: string) {
    setMessage(text)
    speak(text)
  }

  function findNearest() {
    if (stores.length === 0) {
      announce('검색된 가맹점이 없습니다.')
      return
    }

    if (!navigator.geolocation) {
      announce('현재 위치 기능을 지원하지 않습니다.')
      return
    }

    setLoading(true)
    setMessage('도보 경로를 확인하고 있습니다.')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await fetch(
            apiUrl('/api/walking-nearest'),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                stores: stores.map((store) => ({
                  id: store.id,
                  name: store.name,
                  address: store.address,
                  coordinates: store.coordinates,
                })),
              }),
            }
          )

          const data = await response.json()

          if (!response.ok) {
            throw new Error(
              data.error || '도보 경로 조회에 실패했습니다.'
            )
          }

          const result = data as WalkingResult
          const nearest = result.nearest

          const distanceText =
            nearest.meters >= 1000
              ? `약 ${(nearest.meters / 1000).toFixed(1)}킬로미터`
              : `약 ${nearest.meters}미터`

          const nearestText =
            result.compared === result.total
              ? '가장 가까운 곳은'
              : `도보 경로를 확인한 ${result.compared}곳 중 가장 가까운 곳은`

          const text =
            `총 ${result.total}곳이 검색되었습니다. ` +
            `${nearestText} ${nearest.name}입니다. ` +
            `도보 이동 거리는 ${distanceText}입니다. ` +
            `주소는 ${nearest.address}입니다. ` +
            `방문 전 가맹 여부와 이용 가능 여부를 확인해 주세요.`

          announce(text)
        } catch (error) {
          announce(
            error instanceof Error
              ? error.message
              : '도보 경로 조회에 실패했습니다.'
          )
        } finally {
          setLoading(false)
        }
      },
      () => {
        announce(
          '현재 위치를 확인하지 못했습니다. 위치 권한을 확인해 주세요.'
        )
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  }

  useEffect(() => {
    if (trigger === 0) return

    findNearest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger])

  return (
    <div style={{ marginTop: 12, marginBottom: 12 }}>
      <button
        type="button"
        onClick={findNearest}
        disabled={loading}
      >
        {loading
          ? '📍 도보 경로 확인 중...'
          : '📍 도보 경로 다시 확인'}
      </button>

      {message && (
        <div>
          <p role="status" aria-live="polite">
            {message}
          </p>
          <button
            type="button"
            onClick={() => speak(message)}
          >
            🔊 안내 다시 듣기
          </button>
        </div>
      )}
    </div>
  )
}
