// 현재 위치(GPS·와이파이·기지국)를 가져온다. 지도의 "현재 위치로 이동"과 거리순 정렬이 쓴다.
// (길 안내용 정밀 위치는 guideLocation.ts 가 따로 맡는다.)
//
// 실패했을 때 사용자가 무엇을 해야 하는지 알 수 있게 원인별 안내를 돌려준다:
//   unsupported 브라우저가 위치 기능을 못 씀 / insecure HTTPS 가 아님 / denied 권한 거부
//   unavailable 기기가 위치를 못 찾음(위치 꺼짐 등) / timeout 시간 안에 못 받음

export type UserLocation = { lat: number; lng: number; accuracy?: number }

export type LocationErrorReason = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout'

export class LocationError extends Error {
  reason: LocationErrorReason

  constructor(reason: LocationErrorReason) {
    super(locationErrorMessage(reason))
    this.name = 'LocationError'
    this.reason = reason
  }
}

export function locationErrorMessage(reason: LocationErrorReason): string {
  switch (reason) {
    case 'unsupported':
      return '현재 위치 기능을 지원하지 않습니다. 크롬 등 다른 브라우저에서 열어 주세요.'
    case 'insecure':
      return '위치 기능은 https 주소(또는 localhost)에서만 쓸 수 있어요. 주소가 https로 시작하는지 확인해 주세요.'
    case 'denied':
      return '위치 권한이 거부되어 있어요. 주소창 왼쪽의 자물쇠(사이트 설정)에서 위치를 "허용"으로 바꾸고, 인앱 브라우저라면 크롬이나 삼성 인터넷에서 열어 주세요.'
    case 'unavailable':
      return '현재 위치를 찾지 못했어요. 휴대폰의 위치(GPS) 기능이 켜져 있는지 확인해 주세요.'
    case 'timeout':
      return '위치 응답이 너무 늦어요. 실내라면 창가나 실외에서 다시 시도해 주세요.'
  }
}

function reasonOf(error: { code?: number } | null | undefined): LocationErrorReason {
  if (error?.code === 1) return 'denied'
  if (error?.code === 3) return 'timeout'
  return 'unavailable' // 2(위치 없음)와 알 수 없는 오류
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  })
}

// 1차: 와이파이·기지국 위치(빠르고 실내·PC에서도 받아진다. 최근 5분 안의 값도 인정).
// 2차: 1차가 시간 초과·실패하면 GPS 를 켜서 더 오래 기다린다. 권한 거부는 다시 물어도 소용없어서 재시도하지 않는다.
const QUICK: PositionOptions = { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 }
const PRECISE: PositionOptions = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

export async function requestCurrentLocation(): Promise<UserLocation> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new LocationError('insecure')
  if (!navigator.geolocation) throw new LocationError('unsupported')

  let position: GeolocationPosition
  try {
    position = await getPosition(QUICK)
  } catch (first) {
    if (reasonOf(first as { code?: number }) === 'denied') throw new LocationError('denied')
    try {
      position = await getPosition(PRECISE)
    } catch (second) {
      throw new LocationError(reasonOf(second as { code?: number }))
    }
  }

  const { latitude, longitude, accuracy } = position.coords
  return { lat: latitude, lng: longitude, ...(Number.isFinite(accuracy) ? { accuracy } : {}) }
}

/**
 * 위치 권한이 이미 허용됐는지. 'granted' 일 때만 페이지를 열자마자 위치를 가져온다.
 * (묻지도 않고 권한 창을 띄우면 사용자가 무심코 닫거나 거부해서, 이후 사이트가 영구히 차단되는 경우가 많다.)
 * Permissions API 를 못 쓰는 브라우저는 'unknown' 이고, 이때는 사용자가 버튼을 눌렀을 때만 요청한다.
 */
export async function geolocationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return status?.state ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 위치 정확도가 낮을 때(PC·실내에서 IP나 와이파이로 추정한 경우) 알려 줄 문구. 충분히 정확하면 null. */
export function lowAccuracyNotice(accuracy: number | undefined, thresholdMeters = 3000): string | null {
  if (accuracy === undefined || !Number.isFinite(accuracy) || accuracy <= thresholdMeters) return null
  return `위치 정확도가 낮아요(약 ${(accuracy / 1000).toFixed(1)}km). PC나 실내에서는 실제와 다르게 잡힐 수 있어요.`
}
