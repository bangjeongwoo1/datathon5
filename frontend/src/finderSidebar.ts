// 가맹점 지도의 목록(사이드바)과 음성 안내 카드를 접었는지 펼쳤는지 브라우저에 기억해 둔다.
// 저장소를 못 쓰는 환경(시크릿 창, 사이트 데이터 차단 등)에서도 화면은 정상으로 떠야 하므로 모든 접근을 try/catch 로 감싼다.

export const SIDEBAR_STORAGE_KEY = 'eatda.finder.sidebar'
export const VOICE_CARD_STORAGE_KEY = 'eatda.finder.voiceCard'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null // 접근 자체가 막힌 경우
  }
}

function loadOpen(key: string, storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(key) !== 'closed'
  } catch {
    return true
  }
}

function saveOpen(key: string, open: boolean, storage: StorageLike | null): void {
  try {
    storage?.setItem(key, open ? 'open' : 'closed')
  } catch {
    // 저장하지 못해도 이번 화면에서는 그대로 동작한다.
  }
}

/** 마지막으로 저장한 목록 상태. 저장된 값이 없거나 읽을 수 없으면 펼친 상태(true)다. */
export function loadSidebarOpen(storage: StorageLike | null = browserStorage()): boolean {
  return loadOpen(SIDEBAR_STORAGE_KEY, storage)
}

export function saveSidebarOpen(open: boolean, storage: StorageLike | null = browserStorage()): void {
  saveOpen(SIDEBAR_STORAGE_KEY, open, storage)
}

/** 음성 안내 카드("마이크가 준비됐어요")의 마지막 상태. 기본은 펼친 상태다. */
export function loadVoiceCardOpen(storage: StorageLike | null = browserStorage()): boolean {
  return loadOpen(VOICE_CARD_STORAGE_KEY, storage)
}

export function saveVoiceCardOpen(open: boolean, storage: StorageLike | null = browserStorage()): void {
  saveOpen(VOICE_CARD_STORAGE_KEY, open, storage)
}

type VoiceStatusLike = { heard: string; answer: string; error: string }

/**
 * 음성 안내 상태가 바뀌었을 때, 접어 둔 카드를 펼쳐야 하는지 판단한다.
 * - 들은 말·답변·오류 중 무엇이 새로 바뀌었고 그중 답변이나 오류가 있으면 펼친다. (답을 놓치지 않게)
 * - 같은 내용이 되풀이해서 들어오면(상태가 자주 갱신되므로) 사용자가 방금 접은 카드를 다시 펼치지 않는다.
 * previousSignal 은 직전에 돌려받은 signal 이다.
 */
export function revealVoiceCard(previousSignal: string, status: VoiceStatusLike): { signal: string; reveal: boolean } {
  const signal = `${status.heard}|${status.answer}|${status.error}`
  if (signal === previousSignal) return { signal, reveal: false }
  return { signal, reveal: Boolean(status.answer || status.error) }
}
