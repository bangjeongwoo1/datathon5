// 가맹 권유 지도: 카카오맵에 학교·가맹점·미가맹 식당·권유 식당을 그린다.
// 점과 원이 수천 개라, 처음에는 학교와 권유 식당만 그리고
// 가맹 원·식당 점·학교 1km 원은 고른 동네(행정동)나 고른 학교 둘레의 것만 그린다.
// SDK는 팀 공용 로더(src/kakao.ts의 loadKakaoMaps)로 불러온다.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadKakaoMaps } from '../kakao'
import type { MapData, Mode } from './types'

const COLOR = { member: '#2a78d6', cvs: '#eda100', non: '#eb6834', ask: '#1baf7a', covered: '#9a9993', city: '#6250d6', ink: '#0b0b0b' }

export interface Layers { ring: boolean; schoolRing: boolean; non: boolean }
export interface MealcardMapHandle {
  focus: (lat: number, lng: number, level?: number) => void
  fit: (points: [number, number][]) => void // 점들이 모두 보이게 맞춘다
}
interface Props {
  data: MapData; R: number; M: Mode; layers: Layers
  dong: string | null                    // 고른 행정동 코드. 없으면 원·식당 점을 그리지 않는다
  school: number | null                  // 고른 학교(data.schools 번호). 있으면 그 학교 1km 둘레를 동네보다 먼저 그린다
  onSelectSchool?: (i: number) => void
  onSelectRec?: (rank: number) => void   // 권유 식당 점을 눌렀을 때 순위를 알린다
  selectedRank?: number | null
}

// 팀 로더의 타입(MapsSDK)에는 원·다각형·영역 함수가 없어서, 이 파일에서는 느슨한 타입으로 쓴다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type K = any

function dot(color: string, size: number, ring?: string) {
  const el = document.createElement('div')
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color};` +
    `box-shadow:0 0 0 ${ring ? 2 : 1}px ${ring ?? '#fff'};cursor:pointer;transform:translate(-50%,-50%)`
  return el
}

const MealcardMap = forwardRef<MealcardMapHandle, Props>(function MealcardMap({ data, R, M, layers, dong, school, onSelectSchool, onSelectRec, selectedRank }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const kakao = useRef<K>(null)
  const map = useRef<K>(null)
  const tip = useRef<K>(null)              // 마우스 올리면 뜨는 설명 상자(하나를 돌려 씀)
  const fixed = useRef<{ schoolRings: K[]; schoolDots: { el: HTMLDivElement }[]; recs: K[] }>({ schoolRings: [], schoolDots: [], recs: [] })
  const dyn = useRef<K[]>([])              // 고른 동네·학교 둘레의 원과 식당 점
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const onSelect = useRef(onSelectSchool) // 학교 점 클릭은 처음 한 번 붙이므로 최신 콜백을 ref로 들고 있는다
  const state = useRef({ R, M, layers, dong, school })
  useEffect(() => {
    onSelect.current = onSelectSchool
    state.current = { R, M, layers, dong, school }
  })

  useImperativeHandle(ref, () => ({
    fit(points) {
      const k = kakao.current
      if (!map.current || !k || points.length === 0) return
      const b = new k.LatLngBounds()
      points.forEach(([y, x]) => b.extend(new k.LatLng(y, x)))
      map.current.setBounds(b, 40, 40, 40, 40)
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

  // 처음 한 번: SDK, 지도, 춘천시 구역, 학교
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
      fixed.current.schoolRings = data.schools.map((s) => {
        b.extend(new k.LatLng(s.y, s.x))
        return new k.Circle({ center: new k.LatLng(s.y, s.x), radius: data.schoolR,
          strokeWeight: 1, strokeStyle: 'dash', strokeColor: COLOR.covered, strokeOpacity: 0.8, fillColor: COLOR.covered, fillOpacity: 0.04 })
      })
      fixed.current.schoolDots = data.schools.map((s, i) => {
        const el = dot(COLOR.covered, 16)
        hoverable(el, s.y, s.x, () => {
          const { R, M } = state.current
          return `<b>${s.n}</b> (${s.d})<br>1km 안 가맹점 ${s.k1[M].toLocaleString()}곳 (편의점 ${M})<br>1km 안 권유 식당 ${s.rc[M][R]}곳 (가맹 원 ${R}m)`
        })
        el.addEventListener('click', () => onSelect.current?.(i))
        new k.CustomOverlay({ map: m, position: new k.LatLng(s.y, s.x), content: el, zIndex: 5 })
        return { el }
      })
      m.setBounds(b)
      setReady(true)
    }).catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [data, hoverable])

  // 고른 동네·학교 둘레의 가맹점·미가맹 점과 가맹 원
  const drawDynamic = useCallback(() => {
    const k = kakao.current, m = map.current
    if (!m) return
    dyn.current.forEach((o) => o.setMap(null))
    dyn.current = []
    const { R, M, layers, dong, school } = state.current
    if (!dong && school === null) return
    const s = school !== null ? data.schools[school] : null
    const cos = Math.cos(((s?.y ?? 37.9) * Math.PI) / 180)
    const near = (y: number, x: number) => {
      const dy = (y - s!.y) * 111320, dx = (x - s!.x) * 111320 * cos
      return dy * dy + dx * dx <= (data.schoolR + R) ** 2
    }
    const keep = (y: number, x: number, g: string) => (s ? near(y, x) : g === dong)
    const add = (y: number, x: number, color: string, size: number, html: string, circle: boolean) => {
      const pos = new k.LatLng(y, x)
      if (circle && layers.ring) {
        dyn.current.push(new k.Circle({ map: m, center: pos, radius: R, strokeWeight: 0, fillColor: color, fillOpacity: 0.12 }))
      }
      const el = dot(color, size)
      hoverable(el, y, x, () => html)
      dyn.current.push(new k.CustomOverlay({ map: m, position: pos, content: el, zIndex: 2 }))
    }
    for (const [y, x, n, t, g] of data.members) if (keep(y, x, g)) add(y, x, COLOR.member, 6, `<b>${n}</b><br>가맹 · ${t}`, true)
    if (M === '포함') for (const [y, x, n, g] of data.cvs) if (keep(y, x, g)) add(y, x, COLOR.cvs, 6, `<b>${n}</b><br>가맹 · 편의점`, true)
    if (layers.non) for (const [y, x, n, t, g] of data.non) if (keep(y, x, g)) add(y, x, COLOR.non, 7, `<b>${n}</b><br>미가맹 · ${t}`, false)
  }, [data, hoverable])

  // 반경·편의점·레이어·동네·학교가 바뀌면 학교 색, 권유 식당, 원·점을 다시 그린다
  useEffect(() => {
    if (!ready) return
    const k = kakao.current, m = map.current
    data.schools.forEach((s, i) => {
      const has = s.rc[M][R] > 0
      const col = has ? COLOR.ask : COLOR.covered
      const { el } = fixed.current.schoolDots[i]
      el.style.background = col
      el.style.width = el.style.height = has ? '22px' : '16px'
      el.style.boxShadow = `0 0 0 ${has ? 3 : 2}px ${has ? COLOR.ink : '#fff'}`
      if (i === school) el.style.boxShadow = `0 0 0 3px #fff, 0 0 0 6px ${col}`
      fixed.current.schoolRings[i].setOptions({ strokeColor: col, fillColor: col, strokeWeight: has ? 2 : 1 })
      const show = school !== null ? i === school : !!dong && s.g === dong
      fixed.current.schoolRings[i].setMap(layers.schoolRing && show ? m : null)
    })
    fixed.current.recs.forEach((o) => o.setMap(null))
    fixed.current.recs = data.recs.filter((d) => d[0] === M && d[1] === R).map((d) => {
      const [, , rank, y, x, n, t, sch, toSchool, toMember] = d
      const sel = rank === selectedRank
      const el = dot(COLOR.non, sel ? 18 : 13, COLOR.ink)
      if (sel) el.style.boxShadow = `0 0 0 3px #fff, 0 0 0 6px ${COLOR.non}`
      el.addEventListener('click', () => onSelectRec?.(rank))
      hoverable(el, y, x, () => `<b>${n}</b> (${t})<br>가맹 권유 ${rank}위<br>가장 가까운 가맹점 ${toMember.toLocaleString()}m<br>${sch}까지 ${toSchool.toLocaleString()}m`)
      return new k.CustomOverlay({ map: m, position: new k.LatLng(y, x), content: el, zIndex: sel ? 6 : 4 })
    })
    drawDynamic()
  }, [ready, R, M, layers, dong, school, data, drawDynamic, hoverable, onSelectRec, selectedRank])

  if (error) return <div className="mc-map-msg">{error}</div>
  return <div ref={box} className="mc-map" role="img" aria-label="춘천 학교 1km 원과 가맹·미가맹 식당 지도" />
})

export default MealcardMap
