import { distanceBetween } from './walkingProgress.ts'
import type { Point } from './walkingProgress.ts'

export type ArrivalProximity = 'outside' | 'uncertain' | 'nearby' | 'very-close'
export type ArrivalReading = { proximity: ArrivalProximity; distance: number; accuracy: number }

// Coordinates locate a merchant record, not a verified entrance. No outcome means "safe to enter".
export function estimateArrival(fix: Point & { accuracy: number }, destination: Point, remaining: number): ArrivalReading {
  const distance = distanceBetween(fix, destination)
  const accuracy = fix.accuracy
  if (!Number.isFinite(distance) || !Number.isFinite(accuracy) || accuracy <= 0 ||
      !Number.isFinite(remaining) || remaining < 0 || distance > 25 || remaining > 15) {
    return { proximity: 'outside', distance, accuracy }
  }
  if (accuracy > 15) return { proximity: 'uncertain', distance, accuracy }
  // Even this is proximity to the stored coordinates, never proof of entrance arrival.
  if (distance <= 2 && accuracy <= 2 && remaining <= 2) return { proximity: 'very-close', distance, accuracy }
  return { proximity: 'nearby', distance, accuracy }
}

export function merchantCallUrl(raw?: string): string | null {
  if (!raw || !/^[+\d\s().-]+$/.test(raw.trim())) return null
  const phone = raw.trim().replace(/[\s().-]/g, '')
  return /^\+?\d{8,15}$/.test(phone) ? `tel:${phone}` : null
}

export type ArrivalCommand = 'confirm' | 'help' | 'accept-call' | 'decline-call' | null
export function arrivalCommand(text: string, helpOffered: boolean): ArrivalCommand {
  const raw = text.normalize('NFKC').trim()
  const compact = raw.replace(/[\s,.!。！]/g, '')
  if (!/[?？]$/.test(raw) && /^(?:입구(?:를)?찾았(?:어|어요)|입구확인완료|가게안에들어왔(?:어|어요)|도착확인완료)$/.test(compact)) return 'confirm'
  if (/전화(?:하지마|하지말아줘|안할래|안할게)|연결(?:하지마|하지말아줘)/.test(compact)) return 'decline-call'
  if (!/[?？]$/.test(raw) && /^(?:전화(?:연결)?해(?:줘|주세요)|가게에전화(?:연결)?해(?:줘|주세요)|전화로도움요청|전화연결)$/.test(compact)) return 'accept-call'
  if (helpOffered && /^(?:네|예|응|좋아|좋아요|부탁해|연결해줘)$/.test(compact)) return 'accept-call'
  if (helpOffered && /^(?:아니|아니요|괜찮아|괜찮아요|직접찾아볼게|직접찾아볼게요)$/.test(compact)) return 'decline-call'
  if (/입구.*(?:모르|못찾|안보|어려)|(?:잘)?모르겠|가게.*(?:못찾|안보)|도움이?필요/.test(compact) || /^(?:도와줘|도와주세요)$/.test(compact)) return 'help'
  return null
}

export function helpCallScript(storeName: string) {
  return `안녕하세요. ${storeName} 근처에 있는데 입구를 찾기 어렵습니다. 입구 위치를 안내해 주시거나 잠시 밖에서 도와주실 수 있을까요?`
}

// A request to the OS phone handler is observable; actual dialing/connection is not.
export function requestMerchantCall(raw: string | undefined, openPhone: (url: string) => void = url => {
  const link = document.createElement('a')
  link.href = url
  link.style.display = 'none'
  document.body.appendChild(link)
  try { link.click() } finally { link.remove() }
}): 'requested' | 'unavailable' {
  const url = merchantCallUrl(raw)
  if (!url) return 'unavailable'
  try { openPhone(url); return 'requested' } catch { return 'unavailable' }
}
