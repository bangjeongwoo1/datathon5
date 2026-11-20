// 관리자 검수 API 호출. 모든 요청에 로그인 토큰을 붙인다.
import { apiUrl } from './apiUrl.ts'
import type { MenuCategory, SubmittedItem } from './menuSubmission.ts'
import type { ApproveMode, ApprovedItem, CurrentMenu } from './adminItems.ts'

export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export type SubmissionSummary = {
  submission_id: number
  merchant_id: string
  merchant_name: string | null
  merchant_address: string | null
  submitted_email: string | null
  status: SubmissionStatus
  has_uncertain: boolean
  item_count: number
  created_at: string
  reviewed_at: string | null
}

export type SubmissionDetail = SubmissionSummary & {
  items: SubmittedItem[]
  rejected: { name: string; price_text: string; reason: string }[]
  model: string | null
  has_photo: boolean
  review_note: string | null
  current_menus: CurrentMenu[] // 지금 이 가게에 등록된(승인된) 메뉴
}

export type MeInfo = { id: string; email: string; name: string; isAdmin: boolean }

export class AdminApiError extends Error {
  status: number // 0이면 서버에 닿지 못한 경우

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

type Options = { token: string; fetchImpl?: typeof fetch }

async function request(path: string, options: Options, init: RequestInit = {}): Promise<Response> {
  const { token, fetchImpl = fetch } = options
  let response: Response
  try {
    response = await fetchImpl(apiUrl(path), {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new AdminApiError('서버에 연결하지 못했어요. 백엔드가 켜져 있는지 확인해 주세요.', 0)
  }
  if (!response.ok) {
    let message = '요청을 처리하지 못했어요.'
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // JSON이 아니면 기본 문구
    }
    throw new AdminApiError(message, response.status)
  }
  return response
}

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** 로그인한 사람의 정보(관리자인지 포함). 관리자가 아니어도 이메일을 알려 주는 데 쓴다. */
export async function fetchMe(options: Options): Promise<MeInfo> {
  return (await (await request('/api/me', options)).json()) as MeInfo
}

export async function fetchSubmissions(
  status: SubmissionStatus,
  options: Options,
): Promise<SubmissionSummary[]> {
  const body = (await (
    await request(`/api/admin/submissions?status=${status}`, options)
  ).json()) as { items: SubmissionSummary[] }
  return body.items
}

export async function fetchSubmission(id: number, options: Options): Promise<SubmissionDetail> {
  return (await (await request(`/api/admin/submissions/${id}`, options)).json()) as SubmissionDetail
}

/** 사진은 토큰이 필요해 <img src> 로 직접 못 부르므로, 받아서 브라우저 임시 주소로 바꾼다. */
export async function fetchPhotoBlob(id: number, options: Options): Promise<Blob> {
  return await (await request(`/api/admin/submissions/${id}/photo`, options)).blob()
}

export async function approveSubmission(
  id: number,
  payload: { items: ApprovedItem[]; note?: string; mode: ApproveMode },
  options: Options,
) {
  return (await (
    await request(`/api/admin/submissions/${id}/approve`, options, jsonInit(payload))
  ).json()) as {
    status: 'approved'
    merchant_id: string
    mode: ApproveMode
    menu_count: number
    added: number
    updated: number
    removed: number
  }
}

export async function rejectSubmission(id: number, payload: { note?: string }, options: Options) {
  return (await (
    await request(`/api/admin/submissions/${id}/reject`, options, jsonInit(payload))
  ).json()) as { status: 'rejected'; merchant_id: string }
}

export type { MenuCategory }
