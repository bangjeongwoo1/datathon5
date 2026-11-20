// 메뉴판 사진 제보: 파일 검사, 서버 전송, 결과 표시용 도우미.
// 화면(MenuUploadModal)과 분리해 두어 브라우저 없이 테스트할 수 있다.
import { apiUrl } from './apiUrl.ts'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 서버 제한과 같다(사진 한 장당).
export const MAX_PHOTOS = 5 // 한 번에 올릴 수 있는 사진 장수. 서버 제한과 같다.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// AI가 메뉴를 읽는 데 걸리는 시간(혼잡하면 예비 모델로 전환)을 고려한 제한 시간.
// 사진은 서버가 한 장씩(동시에 2장까지) 읽으므로, 장수가 많을수록 넉넉하게 기다린다.
export function submitTimeoutMs(photoCount: number): number {
  return 90_000 + Math.max(0, photoCount - 1) * 45_000
}

export type MenuCategory = 'meal' | 'side' | 'drink' | 'alcohol' | 'unknown'

export type SubmittedItem = {
  name: string
  price_won: number
  price_text: string
  category: MenuCategory
  status: 'ok' | 'uncertain'
  photo?: number // 몇 번째 사진(1부터)에서 읽었는지. 사진을 여러 장 올렸을 때 붙는다.
}

export type MenuSubmission = {
  submission_id: number
  status: 'pending' | 'approved' | 'rejected'
  merchant_id: string
  has_uncertain: boolean
  photo_count?: number
  items: SubmittedItem[]
  rejected: { name: string; price_text: string; reason: string }[]
}

export class MenuSubmissionError extends Error {
  status: number // 0이면 서버에 닿지 못한 경우

  constructor(message: string, status: number) {
    super(message)
    this.name = 'MenuSubmissionError'
    this.status = status
  }
}

/** 사진 파일이 올릴 수 있는 형식·용량인지 확인한다. 문제가 없으면 null. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return 'JPG, PNG, WEBP 형식의 사진만 올릴 수 있어요.'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return '사진 용량은 5MB 이하여야 해요. 더 작은 사진을 골라 주세요.'
  }
  if (file.size === 0) {
    return '빈 파일이에요. 다른 사진을 골라 주세요.'
  }
  return null
}

type PickedFile = { name: string; type: string; size: number; lastModified?: number }

/**
 * 이미 고른 사진에 새로 고른 사진을 더한다. 형식·용량이 맞지 않거나 이미 고른 사진은 빼고,
 * 최대 장수를 넘으면 앞에서부터 MAX_PHOTOS 장까지만 남긴다. 뺀 이유가 있으면 error 에 담는다.
 */
export function addPhotos<T extends PickedFile>(current: T[], picked: T[]): { files: T[]; error: string | null } {
  const files = [...current]
  const problems: string[] = []
  const sameFile = (a: T, b: T) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified

  for (const file of picked) {
    const problem = validateImageFile(file)
    if (problem) {
      problems.push(`${file.name}: ${problem}`)
      continue
    }
    if (files.some(existing => sameFile(existing, file))) continue
    if (files.length >= MAX_PHOTOS) {
      problems.push(`사진은 한 번에 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`)
      break
    }
    files.push(file)
  }
  return { files, error: problems.length ? problems.join('\n') : null }
}

export function formatWon(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`
}

export function categoryLabel(category: MenuCategory): string {
  switch (category) {
    case 'meal':
      return '식사'
    case 'side':
      return '사이드'
    case 'drink':
      return '음료'
    case 'alcohol':
      return '주류'
    default:
      return '미분류'
  }
}

type SubmitOptions = {
  merchantId: string
  files?: Blob[] // 여러 장(최대 5장). 올린 순서가 사진 번호가 된다.
  file?: Blob // 한 장만 보낼 때(예전 방식)
  accessToken?: string | null // 로그인한 사용자의 토큰. 서버가 검증하기 시작하면 사용된다.
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/** 가게의 메뉴판 사진을 제보한다. 성공하면 검수 대기 상태의 제보 결과를 돌려준다. */
export async function submitMenuPhoto(options: SubmitOptions): Promise<MenuSubmission> {
  const { merchantId, accessToken, signal, fetchImpl = fetch } = options
  const files = options.files ?? (options.file ? [options.file] : [])
  if (files.length === 0) throw new MenuSubmissionError('메뉴판 사진을 골라 주세요.', 400)
  if (files.length > MAX_PHOTOS) {
    throw new MenuSubmissionError(`사진은 한 번에 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`, 400)
  }

  const form = new FormData()
  for (const file of files) form.append('images', file)

  const headers: Record<string, string> = {}
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  // 제한 시간과 호출한 쪽의 취소를 하나의 신호로 합친다.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, submitTimeoutMs(files.length))
  const abortFromCaller = () => controller.abort()
  signal?.addEventListener('abort', abortFromCaller)

  try {
    let response: Response
    try {
      response = await fetchImpl(
        apiUrl(`/api/merchants/${encodeURIComponent(merchantId)}/menu-submissions`),
        { method: 'POST', body: form, headers, signal: controller.signal },
      )
    } catch (error) {
      if (timedOut) {
        throw new MenuSubmissionError(
          '분석 시간이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.',
          0,
        )
      }
      if (signal?.aborted) throw error // 사용자가 닫은 경우: 호출한 쪽이 조용히 처리한다.
      throw new MenuSubmissionError(
        '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
        0,
      )
    }

    if (!response.ok) {
      let message = '사진을 제출하지 못했어요. 잠시 후 다시 시도해 주세요.'
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string') message = body.error
      } catch {
        // 서버가 JSON이 아닌 응답을 준 경우에는 기본 문구를 쓴다.
      }
      throw new MenuSubmissionError(message, response.status)
    }

    return (await response.json()) as MenuSubmission
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
