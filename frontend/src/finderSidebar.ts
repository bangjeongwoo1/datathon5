// 가맹점 지도의 목록(사이드바)을 접었는지 펼쳤는지 브라우저에 기억해 둔다.
// 저장소를 못 쓰는 환경(시크릿 창, 사이트 데이터 차단 등)에서도 화면은 정상으로 떠야 하므로 모든 접근을 try/catch 로 감싼다.

export const SIDEBAR_STORAGE_KEY = 'eatda.finder.sidebar'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null // 접근 자체가 막힌 경우
  }
}

/** 마지막으로 저장한 상태. 저장된 값이 없거나 읽을 수 없으면 펼친 상태(true)다. */
export function loadSidebarOpen(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) !== 'closed'
  } catch {
    return true
  }
}

export function saveSidebarOpen(open: boolean, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, open ? 'open' : 'closed')
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 동작한다.
  }
}
