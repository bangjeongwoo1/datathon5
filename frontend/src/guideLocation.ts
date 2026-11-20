export type NavigationFix = { lat: number; lng: number; accuracy: number }
export class GuideLocationError extends Error {}

export function navigationPosition(position: GeolocationPosition, now = Date.now()): NavigationFix {
  const { latitude: lat, longitude: lng, accuracy } = position.coords
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      !Number.isFinite(accuracy) || accuracy <= 0) {
    throw new GuideLocationError('유효한 GPS 위치를 받지 못했어요. 기기의 위치 기능을 확인해 주세요.')
  }
  if (!Number.isFinite(position.timestamp) || now - position.timestamp > 20000 || position.timestamp > now + 5000) {
    throw new GuideLocationError('GPS 위치가 갱신되지 않았어요. 실외에서 위치를 다시 확인해 주세요.')
  }
  return { lat, lng, accuracy }
}

function availability() {
  if (window.isSecureContext === false) return '휴대폰 위치 기능은 HTTPS 주소에서 사용할 수 있어요.'
  if (!navigator.geolocation) return '현재 브라우저가 위치 기능을 지원하지 않아요. 휴대폰 브라우저에서 열어 주세요.'
  return null
}

export function navigationLocationError(error: Pick<GeolocationPositionError, 'code'>) {
  return error.code === 1
    ? '위치 접근이 차단됐어요. 휴대폰의 위치 기능과 인터넷 앱·이 사이트의 위치 권한을 모두 허용해 주세요.'
    : error.code === 2
      ? '현재 위치를 수신하지 못했어요. 기기의 위치 기능을 켜고 실외에서 다시 확인해 주세요.'
      : '현재 위치 응답이 늦어지고 있어요. 위치 기능을 켜고 다시 요청해 주세요.'
}

export function requestNavigationFix(): Promise<NavigationFix> {
  return new Promise((resolve, reject) => {
    const unavailable = availability()
    if (unavailable) return reject(new GuideLocationError(unavailable))
    const timer = setTimeout(() => reject(new GuideLocationError(navigationLocationError({ code: 3 }))), 10000)
    try {
      navigator.geolocation.getCurrentPosition(position => {
        clearTimeout(timer)
        try { resolve(navigationPosition(position)) } catch (error) { reject(error) }
      }, error => {
        clearTimeout(timer)
        reject(new GuideLocationError(navigationLocationError(error)))
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
    } catch {
      clearTimeout(timer)
      reject(new GuideLocationError('위치 요청을 시작하지 못했어요. 인터넷 앱의 위치 권한을 확인해 주세요.'))
    }
  })
}

export function watchNavigationFix(onFix: (fix: NavigationFix) => void, onError: (message: string) => void): () => void {
  const unavailable = availability()
  if (unavailable) { onError(unavailable); return () => {} }
  let active = true
  let watch: number
  try {
    watch = navigator.geolocation.watchPosition(position => {
      if (!active) return
      try { onFix(navigationPosition(position)) } catch (error) {
        onError(error instanceof GuideLocationError ? error.message : '유효한 GPS 위치를 받지 못했어요.')
      }
    }, error => { if (active) onError(navigationLocationError(error)) },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
  } catch {
    onError('위치 추적을 시작하지 못했어요. 인터넷 앱의 위치 권한을 확인해 주세요.')
  }
  return () => { active = false; if (watch !== undefined) navigator.geolocation.clearWatch(watch) }
}
