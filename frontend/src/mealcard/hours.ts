// 시간대별 사각지대 (테스트, 2026-11-20)
// public/mealcard/hours-{시군}.json: 지도 가맹점마다 [평일, 토요일, 공휴일] 영업 판정 비트(-1 = 영업시간 모름)
// 비트 1=점심(11~14시), 2=저녁(17~20시)에 30분 이상 영업 (팀 결정, 2026-11-20)
// 2_코드/영업시간_지도연결.py가 만든다. 영업시간을 모르는 가맹점은 그 시간대에 연 곳으로 세지 않는다.
import type { MapData, Mode, Place, Cvs, Rec, RecSummary, School } from './types'

export type Slot = 'all' | 'lunch' | 'dinner'
// 급식카드는 학기 중에는 주말·공휴일에만 쓴다 → 토요일·일요일(공휴일)이 기본, 평일은 방학 때만 의미가 있다
// staging의 공휴일 열(holidayOper…)에는 네이버의 일·일요일·공휴일 시간이 들어 있다(팀 build_merchant_master.py)
export type Day = 'sat' | 'sun' | 'wkd'
export const DAY_LABEL: Record<Day, string> = { sat: '토요일', sun: '일요일·공휴일', wkd: '평일(방학)' }
const DAY_INDEX: Record<Day, number> = { wkd: 0, sat: 1, sun: 2 } // hours JSON의 [평일, 토요일, 공휴일] 순서
export interface Hours {
  members: number[][]
  cvs: number[][]
  known: { members: number; members_all: number; cvs: number; cvs_all: number }
  source: string
}

export const SLOT_LABEL: Record<Slot, string> = { all: '전체', lunch: '점심 11~14시', dinner: '저녁 17~20시' }

const bitOf = (slot: Slot) => (slot === 'lunch' ? 1 : 2)

// 짧은 거리(수 km)용 평면 근사 거리(m)
function dist(y1: number, x1: number, y2: number, x2: number) {
  const k = Math.cos(((y1 + y2) / 2) * Math.PI / 180)
  return Math.hypot((y2 - y1) * 111320, (x2 - x1) * 111320 * k)
}

// 가장 가까운 점까지 거리. 점이 많아서 0.01도(약 1km) 칸으로 나눠 가까운 칸부터 본다
function nearestFinder(pts: [number, number][]) {
  const grid = new Map<string, [number, number][]>()
  for (const p of pts) {
    const key = `${Math.floor(p[0] * 100)}:${Math.floor(p[1] * 100)}`
    const a = grid.get(key)
    if (a) a.push(p)
    else grid.set(key, [p])
  }
  return (y: number, x: number) => {
    const gy = Math.floor(y * 100), gx = Math.floor(x * 100)
    let best = Infinity
    for (let r = 0; r <= 60; r++) {
      // r칸 떨어진 테두리 칸을 본다. 찾은 거리보다 테두리가 멀면 멈춘다
      if (best < (r - 1) * 880) break
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue
          for (const p of grid.get(`${gy + dy}:${gx + dx}`) ?? []) best = Math.min(best, dist(y, x, p[0], p[1]))
        }
      }
    }
    return best
  }
}

// 고른 시간대에 여는 가맹점만 남기고 학교 1km 숫자·권유 식당을 다시 계산한 지도 데이터
// 그 요일에 영업시간이 확인된 가맹 식당·편의점 수
export function knownCount(hours: Hours, day: Day) {
  const d = DAY_INDEX[day]
  return { members: hours.members.filter((v) => v[d] >= 0).length, cvs: hours.cvs.filter((v) => v[d] >= 0).length }
}

export function applyHours(raw: MapData, hours: Hours, slot: Slot, day: Day): MapData {
  if (slot === 'all') return raw
  const bit = bitOf(slot)
  const d = DAY_INDEX[day]
  const open = (v: number[] | undefined) => !!v && v[d] >= 0 && (v[d] & bit) > 0
  const members: Place[] = raw.members.filter((_, i) => open(hours.members[i]))
  const cvs: Cvs[] = raw.cvs.filter((_, i) => open(hours.cvs[i]))
  const sets: Record<Mode, [number, number][]> = {
    미포함: members.map((p) => [p[0], p[1]]),
    포함: [...members, ...cvs].map((p) => [p[0], p[1]]),
  }
  const R = raw.schoolR
  // 미가맹 식당마다 1km 안 학교(시간대와 무관)
  const nearSchools = raw.non.map((p) => raw.schools.map((s, k) => [k, dist(s.y, s.x, p[0], p[1])] as const).filter(([, d]) => d <= R))
  // 도로명주소는 원래 권유 목록에서 찾아 붙인다(미가맹 목록에는 주소가 없음)
  const addr = new Map<string, string>()
  for (const r of raw.recs) addr.set(`${r[3]},${r[4]},${r[5]}`, r[10])

  const schools: School[] = raw.schools.map((s) => ({ ...s, k1: { ...s.k1 }, rc: { 미포함: {}, 포함: {} } }))
  const recs: Rec[] = []
  const recSummary: RecSummary[] = []
  for (const mode of ['미포함', '포함'] as Mode[]) {
    const pts = sets[mode]
    schools.forEach((s) => { s.k1[mode] = pts.filter((p) => dist(s.y, s.x, p[0], p[1]) <= R).length })
    const near = nearestFinder(pts)
    const dMem = raw.non.map((p) => near(p[0], p[1]))
    if (mode === '미포함') schools.forEach((s) => { const d = near(s.y, s.x); s.m = Number.isFinite(d) ? Math.round(d) : 99999 })
    for (const r of raw.radii) {
      const cnt = new Array(schools.length).fill(0)
      const list: Rec[] = []
      raw.non.forEach((p, j) => {
        if (!nearSchools[j].length || dMem[j] <= r) return
        nearSchools[j].forEach(([k]) => { cnt[k] += 1 })
        const [k, d] = nearSchools[j].reduce((a, b) => (b[1] < a[1] ? b : a))
        const toMember = Number.isFinite(dMem[j]) ? Math.round(dMem[j]) : 99999
        list.push([mode, r, 0, p[0], p[1], p[2], p[3], raw.schools[k].n, Math.round(d), toMember, addr.get(`${p[0]},${p[1]},${p[2]}`) ?? '', p[4]])
      })
      list.sort((a, b) => b[9] - a[9]).forEach((x, i) => { x[2] = i + 1 })
      recs.push(...list)
      schools.forEach((s, k) => { s.rc[mode][String(r)] = cnt[k] })
      recSummary.push({ 편의점: mode, 가맹원반경_m: r, 권유식당: list.length, 권유식당있는학교: cnt.filter((c) => c > 0).length })
    }
  }
  return { ...raw, members, cvs, schools, recs, recSummary }
}
