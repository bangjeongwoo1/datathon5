// 가맹 권유 지도: 카카오맵에 학교·가맹점·미가맹 식당·권유 식당을 그린다.
// 확대 정도에 따라 3단계로 그린다 (2026-11-17, 부동산 지도처럼):
//   1단계(멀리)  : 읍·면·동 이름표만. 누르면 그 동네로 들어간다
//   2단계(중간)  : 화면 안 학교 아이콘(시계탑 학교) + 주황 숫자 배지 = 그 학교 1km 안 권유 식당 수. 누르면 그 학교를 고른다
//   3단계(가까이): 화면 안의 학교·권유 식당·가맹/미가맹 식당 점과 원 (원래 보던 모습)
//                  학교는 이름표끼리 겹치지 않는 것만 이름표(예: 남춘천초)를 붙이고, 겹치면 아이콘+숫자만
//                  단, 화면 안 점이 너무 많으면(강릉 시내 등) 권유 식당을 화면 칸마다 묶은 숫자 원으로 보여 주고
//                  더 확대하면 점으로 푼다
// 고른 학교는 단계와 상관없이 점과 1km 원을 그리고, 1·2단계에서도 그 1km 안의 식당 점을 그린다. 고른 동네는 목록용이고, 지도는 확대 단계로 그린다.
// SDK는 팀 공용 로더(src/kakao.ts의 loadKakaoMaps)로 불러온다.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadKakaoMaps } from '../kakao'
import type { MapData, Mode } from './types'

const COLOR = { member: '#2a78d6', cvs: '#eda100', non: '#eb6834', ask: '#1baf7a', covered: '#9a9993', city: '#6250d6', ink: '#0b0b0b' }

// 카카오 지도 확대 수준(level): 숫자가 클수록 멀리 본다.
const STAGE1_FROM = 6   // 6 이상: 1단계(읍·면·동 이름)
const STAGE3_TO = 2     // 2 이하: 3단계(점). 그 사이(3~5)는 2단계(학교별 숫자 원)
const CELL = 90         // 점이 많은 곳에서 권유 식당을 묶는 화면 칸 크기(px)
const MAX_DOTS = 700    // 3단계 수준이라도 화면 안 점이 이보다 많으면 권유 식당 묶음 숫자로 보여 준다

export interface Layers { ring: boolean; schoolRing: boolean; non: boolean }
export interface MealcardMapHandle {
  focus: (lat: number, lng: number, level?: number) => void
  fit: (points: [number, number][], maxLevel?: number) => void // 점들이 모두 보이게 맞춘다. maxLevel보다 멀리 가지 않는다
}
interface Props {
  data: MapData; R: number; M: Mode; layers: Layers
  dong: string | null                    // 고른 행정동 코드 (목록용. 지도는 확대 단계로 그린다)
  school: number | null                  // 고른 학교(data.schools 번호). 단계와 상관없이 그 학교 점과 1km 원을 그린다
  onSelectSchool?: (i: number) => void
  onSelectRec?: (rank: number) => void   // 권유 식당 점을 눌렀을 때 순위를 알린다
  onSelectDong?: (code: string) => void  // 1단계의 읍·면·동 이름을 눌렀을 때 행정동 코드를 알린다
  selectedRank?: number | null
}

// 팀 로더의 타입(MapsSDK)에는 원·다각형·영역 함수가 없어서, 이 파일에서는 느슨한 타입으로 쓴다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any
type View = { level: number; s: number; w: number; n: number; e: number }

function dot(color: string, size: number, ring?: string) {
  const el = document.createElement('div')
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};` +
    `box-shadow:0 0 0 ${ring ? 2 : 1}px ${ring ?? '#fff'};cursor:pointer;transform:translate(-50%,-50%)`
  return el
}

// 1단계: 읍·면·동 이름표
function dongLabel(name: string) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'mc-dong-label'
  el.style.transform = 'translate(-50%,-50%)'
  el.textContent = `${name} ›`
  el.setAttribute('aria-label', `${name}로 들어가기`)
  return el
}

// 2단계: 권유 식당 수 원
function countBubble(n: number) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'mc-count'
  const size = Math.round(Math.min(64, 34 + Math.sqrt(n) * 2.4))
  el.style.cssText = `width:${size}px;height:${size}px;transform:translate(-50%,-50%)`
  el.textContent = n.toLocaleString('ko-KR')
  el.setAttribute('aria-label', `권유 식당 ${n}곳, 누르면 확대`)
  return el
}

// 학교 표시(H안): 동그란 학교 아이콘(시계탑·깃발 건물) + 주황 숫자 배지(1km 안 권유 식당 수).
// 3단계에서 자리가 나면 흰 알약 안에 아이콘과 학교 이름이 함께 붙는다. 권유 식당이 없으면 회색·배지 없음, 고른 학교는 아이콘 고리.
const SCHOOL_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true">' +
  '<path d="M16 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M16 3.2h5.2l-1.3 1.4 1.3 1.4H16z" fill="currentColor"/>' +
  '<path d="M11.5 12 16 7.5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<rect x="12" y="11.5" width="8" height="17" fill="currentColor"/>' +
  '<rect x="3.5" y="17" width="25" height="11.5" fill="currentColor"/>' +
  '<path d="M2.5 17.5 9 13.5h14l6.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<circle cx="16" cy="15" r="2.4" fill="var(--hole)"/>' +
  '<rect x="14.2" y="22" width="3.6" height="6.5" rx=".8" fill="var(--hole)"/>' +
  '<rect x="5.5" y="19.5" width="3" height="3" fill="var(--hole)"/><rect x="5.5" y="24" width="3" height="2.6" fill="var(--hole)"/>' +
  '<rect x="23.5" y="19.5" width="3" height="3" fill="var(--hole)"/><rect x="23.5" y="24" width="3" height="2.6" fill="var(--hole)"/>' +
  '<rect x="9.5" y="19.5" width="1.6" height="3" fill="var(--hole)"/><rect x="20.9" y="19.5" width="1.6" height="3" fill="var(--hole)"/>' +
  '</svg>'
function schoolMarker() {
  const el = document.createElement('div')
  el.className = 'mc-school'
  // 아이콘 가운데가 학교 위치에 오게 맞춘다 (알약 안쪽 여백 3px + 아이콘 반지름 14px)
  el.style.transform = 'translate(-17px,-50%)'
  el.innerHTML = '<span class="mc-school-ic">' + SCHOOL_SVG + '<span class="mc-school-badge"></span></span><span class="mc-school-name"></span>'
  return el
}

// 이름표용 짧은 학교 이름: 남춘천초등학교 → 남춘천초, 남춘천여자중학교 → 남춘천여중, 춘천교육대학교부설초등학교 → 춘천교대부설초
const shortName = (n: string) => n
  .replace(/여자중학교$/, '여중').replace(/여자고등학교$/, '여고')
  .replace(/초등학교$/, '초').replace(/중학교$/, '중').replace(/고등학교$/, '고')
  .replace('교육대학교', '교대')

const MealcardMap = forwardRef<MealcardMapHandle, Props>(function MealcardMap({ data, R, M, layers, school, onSelectSchool, onSelectRec, onSelectDong, selectedRank }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const kakao = useRef<K>(null)
  const map = useRef<K>(null)
  const tip = useRef<K>(null)              // 마우스 올리면 뜨는 설명 상자(하나를 돌려 씀)
  const schools = useRef<{ el: HTMLDivElement; ov: K; ring: K }[]>([])
  const drawn = useRef<K[]>([])            // 단계마다 새로 그리는 것(이름표·숫자 원·점·원)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')
  const onSelect = useRef(onSelectSchool) // 학교 점 클릭은 처음 한 번 붙이므로 최신 콜백을 ref로 들고 있는다
  const state = useRef({ R, M, data }) // 학교 설명 상자는 처음 한 번 붙이므로 최신 조건·데이터(시간대 재계산 포함)를 ref로 본다
  useEffect(() => {
    onSelect.current = onSelectSchool
    state.current = { R, M, data }
  })

  useImperativeHandle(ref, () => ({
    fit(points, maxLevel) {
      const k = kakao.current
      if (!map.current || !k || points.length === 0) return
      const b = new k.LatLngBounds()
      points.forEach(([y, x]) => b.extend(new k.LatLng(y, x)))
      map.current.setBounds(b, 40, 40, 40, 40)
      if (maxLevel !== undefined && map.current.getLevel() > maxLevel) map.current.setLevel(maxLevel)
    },
    focus(lat, lng, level = 3) {
      const k = kakao.current
      if (!map.current || !k) return
      map.current.setLevel(level)
      map.current.panTo(new k.LatLng(lat, lng))
    },
  }))

  const showTip = useCallback((lat: number, lng: number, html: string) => {
    const k = kakao.current
    tip.current.setContent(`<div class="mc-tip">${html}</div>`)
    tip.current.setPosition(new k.LatLng(lat, lng))
    tip.current.setMap(map.current)
  }, [])
  const hideTip = useCallback(() => tip.current?.setMap(null), [])
  const hoverable = useCallback((el: HTMLElement, lat: number, lng: number, html: () => string) => {
    el.addEventListener('mouseenter', () => showTip(lat, lng, html()))
    el.addEventListener('mouseleave', hideTip)
  }, [showTip, hideTip])

  // 처음 한 번: SDK, 지도, 시군 구역, 학교 점·원(아직 올리지 않음), 확대·이동 감시
  // (시군을 바꾸면 MealcardApp이 key로 이 컴포넌트를 새로 만든다)
  useEffect(() => {
    let alive = true
    loadKakaoMaps(import.meta.env.VITE_KAKAO_MAP_APP_KEY || '').then((maps) => {
      if (!alive || !box.current || map.current) return
      const k = maps as K
      kakao.current = k
      const m = new k.Map(box.current, { center: new k.LatLng(37.88, 127.73), level: 9 })
      map.current = m
      tip.current = new k.CustomOverlay({ yAnchor: 1.25, zIndex: 10 })

      for (const f of data.boundary.features) {
        const g = f.geometry
        const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
        for (const p of polys) {
          new k.Polygon({
            map: m, path: p.map((ring) => ring.map(([x, y]) => new k.LatLng(y, x))),
            strokeWeight: 2, strokeColor: COLOR.city, strokeOpacity: 0.9, fillColor: COLOR.city, fillOpacity: 0.08,
          })
        }
      }

      const b = new k.LatLngBounds()
      schools.current = data.schools.map((s, i) => {
        b.extend(new k.LatLng(s.y, s.x))
        const ring = new k.Circle({ center: new k.LatLng(s.y, s.x), radius: data.schoolR,
          strokeWeight: 1, strokeStyle: 'dash', strokeColor: COLOR.covered, strokeOpacity: 0.8, fillColor: COLOR.covered, fillOpacity: 0.04 })
        const el = schoolMarker()
        hoverable(el, s.y, s.x, () => {
          const { R, M, data: cur } = state.current
          const t = cur.schools[i] ?? s
          return `<b>${t.n}</b> (${t.d})<br>1km 안 가맹점 ${t.k1[M].toLocaleString()}곳 (편의점 ${M})<br>1km 안 권유 식당 ${t.rc[M][R]}곳 (가맹 원 ${R}m)`
        })
        el.addEventListener('click', () => onSelect.current?.(i))
        const ov = new k.CustomOverlay({ map: null, position: new k.LatLng(s.y, s.x), content: el, zIndex: 5 })
        return { el, ov, ring }
      })
      // 확대·이동이 끝날 때마다 보이는 범위와 확대 수준을 기억한다 → 아래 효과가 단계에 맞게 다시 그림
      const remember = () => {
        const bb = m.getBounds(), sw = bb.getSouthWest(), ne = bb.getNorthEast()
        setView({ level: m.getLevel(), s: sw.getLat(), w: sw.getLng(), n: ne.getLat(), e: ne.getLng() })
      }
      k.event.addListener(m, 'idle', remember)
      m.setBounds(b)
      remember()
    }).catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [data, hoverable])

  // 확대 단계·보이는 범위·조건이 바뀌면 다시 그린다
  useEffect(() => {
    const k = kakao.current, m = map.current
    if (!m || !view) return
    drawn.current.forEach((o) => o.setMap(null))
    drawn.current = []
    const put = (o: K) => { drawn.current.push(o) }
    // 화면 안인지 (가장자리에서 잘리지 않게 조금 넉넉히)
    const padY = (view.n - view.s) * 0.1, padX = (view.e - view.w) * 0.1
    const inView = (y: number, x: number) => y >= view.s - padY && y <= view.n + padY && x >= view.w - padX && x <= view.e + padX
    const pool = data.recs.filter((d) => d[0] === M && d[1] === R)
    const stage = view.level >= STAGE1_FROM ? 1 : view.level > STAGE3_TO ? 2 : 3
    let dense = false   // 3단계인데 점이 너무 많음 → 권유 식당 묶음 숫자
    if (stage === 3) {
      let n = 0
      for (const d of pool) if (inView(d[3], d[4])) n++
      for (const p of data.members) if (inView(p[0], p[1])) n++
      if (layers.non) for (const p of data.non) if (inView(p[0], p[1])) n++
      dense = n > MAX_DOTS
    }

    // 학교: 3단계는 화면 안 학교 전부, 1·2단계는 고른 학교만
    // 3단계: 화면 안 학교 중 이름표끼리 안 겹치는 것만 이름표. 고른 학교 → 권유 식당 많은 학교 순으로 자리를 먼저 준다
    const labeled = new Set<number>()
    if (stage === 3) {
      const proj = m.getProjection()
      const boxes: [number, number, number, number][] = []
      const order = data.schools.map((_, i) => i).filter((i) => inView(data.schools[i].y, data.schools[i].x))
        .sort((a, b) => (b === school ? 1 : 0) - (a === school ? 1 : 0) || data.schools[b].rc[M][R] - data.schools[a].rc[M][R])
      for (const i of order) {
        const s = data.schools[i]
        const p = proj.containerPointFromCoords(new k.LatLng(s.y, s.x))
        const w = 14 + 5 + shortName(s.n).length * 12.5 + 12   // 아이콘 반 + 간격 + 글자 + 오른쪽 여백
        const box: [number, number, number, number] = [p.x - 20, p.y - 22, p.x + w, p.y + 18]
        if (boxes.every(([a, b, c, d]) => box[2] < a || box[0] > c || box[3] < b || box[1] > d)) {
          boxes.push(box)
          labeled.add(i)
        }
      }
    }
    data.schools.forEach((s, i) => {
      const n = s.rc[M][R]
      const has = n > 0
      const col = has ? COLOR.ask : COLOR.covered
      const { el, ov, ring } = schools.current[i]
      // 2·3단계는 화면 안 학교 아이콘, 1단계는 고른 학교만
      const show = i === school || (stage >= 2 && inView(s.y, s.x))
      ov.setMap(show ? m : null)
      el.classList.toggle('none', !has)
      el.classList.toggle('sel', i === school)
      el.classList.toggle('labeled', labeled.has(i))
      ;(el.querySelector('.mc-school-name') as HTMLElement).textContent = shortName(s.n)
      const badge = el.querySelector('.mc-school-badge') as HTMLElement
      badge.textContent = has ? n.toLocaleString('ko-KR') : ''
      badge.style.display = has ? '' : 'none'
      ov.setZIndex(i === school ? 8 : has ? 5 : 4)
      // 학교 1km 원은 고른 학교만 (여러 학교 원이 겹쳐 지도를 덮지 않게)
      ring.setOptions({ strokeColor: col, fillColor: col, strokeWeight: 2 })
      ring.setMap(layers.schoolRing && i === school ? m : null)
    })

    if (stage === 1) {
      // 1단계: 읍·면·동 이름. 위치는 그 동네 학교·가맹·미가맹 식당들의 가운데
      const by = new Map<string, { n: number; y: number; x: number }>()
      const add = (g: string, y: number, x: number) => {
        const v = by.get(g) ?? { n: 0, y: 0, x: 0 }
        v.n += 1; v.y += y; v.x += x
        by.set(g, v)
      }
      for (const s of data.schools) add(s.g, s.y, s.x)
      for (const p of data.members) add(p[4], p[0], p[1])
      for (const p of data.non) add(p[4], p[0], p[1])
      for (const d of data.dongs) {
        const v = by.get(d.c)
        if (!v) continue
        const el = dongLabel(d.n)
        el.addEventListener('click', () => onSelectDong?.(d.c))
        put(new k.CustomOverlay({ map: m, position: new k.LatLng(v.y / v.n, v.x / v.n), content: el, zIndex: 7 }))
      }
    }

    // 점을 그릴 범위: 3단계는 화면 안, 1·2단계는 고른 학교의 1km 안 (고른 학교가 없으면 점 없음)
    let within = inView
    if (stage < 3) {
      if (school === null) return
      const s = data.schools[school]
      const cos = Math.cos((s.y * Math.PI) / 180)
      // 학교 기준 위아래·좌우 schoolR(1km) 사각형 밖이면 거리 계산 없이 바로 버리고, 안에 든 것만 피타고라스로 원 안인지 본다
      const dy = data.schoolR / 111320, dx = data.schoolR / (111320 * cos)
      within = (y: number, x: number) =>
        Math.abs(y - s.y) <= dy && Math.abs(x - s.x) <= dx &&
        Math.hypot((y - s.y) * 111320, (x - s.x) * 111320 * cos) <= data.schoolR
    } else if (dense) {
      // 3단계 수준인데 점이 너무 많은 곳: 권유 식당을 화면 칸(CELL px)마다 묶어 숫자 원 하나로
      const proj = m.getProjection()
      const cells = new Map<string, { n: number; y: number; x: number }>()
      for (const d of pool) {
        if (!inView(d[3], d[4])) continue
        const p = proj.containerPointFromCoords(new k.LatLng(d[3], d[4]))
        const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`
        const c = cells.get(key) ?? { n: 0, y: 0, x: 0 }
        c.n += 1; c.y += d[3]; c.x += d[4]
        cells.set(key, c)
      }
      for (const c of cells.values()) {
        const y = c.y / c.n, x = c.x / c.n
        const el = countBubble(c.n)
        el.classList.add('recs')
        el.addEventListener('click', () => { m.setLevel(Math.max(1, view.level - 1), { anchor: new k.LatLng(y, x) }) })
        hoverable(el, y, x, () => `권유 식당 <b>${c.n.toLocaleString()}</b>곳<br>누르면 확대해서 식당이 보여요`)
        put(new k.CustomOverlay({ map: m, position: new k.LatLng(y, x), content: el, zIndex: 6 }))
      }
      return
    }

    // 3단계는 화면 안, 1·2단계는 고른 학교 1km 안의 가맹 식당(+원)·편의점·미가맹 식당·권유 식당 점
    const add = (y: number, x: number, color: string, size: number, html: string, circle: boolean) => {
      const pos = new k.LatLng(y, x)
      if (circle && layers.ring) put(new k.Circle({ map: m, center: pos, radius: R, strokeWeight: 0, fillColor: color, fillOpacity: 0.12 }))
      const el = dot(color, size)
      hoverable(el, y, x, () => html)
      put(new k.CustomOverlay({ map: m, position: pos, content: el, zIndex: 2 }))
    }
    for (const [y, x, n, t] of data.members) if (within(y, x)) add(y, x, COLOR.member, 6, `<b>${n}</b><br>가맹 · ${t}`, true)
    if (M === '포함') for (const [y, x, n] of data.cvs) if (within(y, x)) add(y, x, COLOR.cvs, 6, `<b>${n}</b><br>가맹 · 편의점`, true)
    if (layers.non) for (const [y, x, n, t] of data.non) if (within(y, x)) add(y, x, COLOR.non, 7, `<b>${n}</b><br>미가맹 · ${t}`, false)
    for (const d of pool) {
      const [, , rank, y, x, n, t, sch, toSchool, toMember] = d
      if (!within(y, x)) continue
      const sel = rank === selectedRank
      const el = dot(COLOR.non, sel ? 18 : 13, COLOR.ink)
      if (sel) el.style.boxShadow = `0 0 0 3px #fff, 0 0 0 6px ${COLOR.non}`
      el.addEventListener('click', () => onSelectRec?.(rank))
      hoverable(el, y, x, () => `<b>${n}</b> (${t})<br>가맹 권유 ${rank}위<br>가장 가까운 가맹점 ${toMember.toLocaleString()}m<br>${sch}까지 ${toSchool.toLocaleString()}m`)
      put(new k.CustomOverlay({ map: m, position: new k.LatLng(y, x), content: el, zIndex: sel ? 6 : 4 }))
    }
  }, [view, R, M, layers, school, data, hoverable, onSelectRec, onSelectDong, selectedRank])

  if (error) return <div className="mc-map-msg">{error}</div>
  return <div ref={box} className="mc-map" role="img" aria-label={`${data.city ?? '춘천시'} 학교 1km 원과 가맹·미가맹 식당 지도`} />
})

export default MealcardMap
