// 가맹 권유 지도 화면. Next.js(SEED Design) 버전을 React + 일반 CSS로 옮긴 것이다.
// 헤더 / 지도(+ 조건 패널, 선택한 식당·학교 카드) / 오른쪽 사이드바(요약·탭).
// 좁은 화면에서는 사이드바가 아래에서 올라오는 서랍이 된다. 스타일은 mealcard.css(.mc 아래로만 적용).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import MealcardMap from './MealcardMap'
import type { Layers, MealcardMapHandle } from './MealcardMap'
import type { MapData, Mode, Rec } from './types'
import './mealcard.css'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const DATA_URL = `${import.meta.env.BASE_URL}mealcard/map-data.json`

function Seg({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: [string, string][]; label: string }) {
  return (
    <div className="mc-seg" role="radiogroup" aria-label={label}>
      {items.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (c: boolean) => void; label: string }) {
  return (
    <label className="mc-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track"><span className="thumb" /></span>
      {label}
    </label>
  )
}

function Dot({ color, ring, square }: { color: string; ring?: boolean; square?: boolean }) {
  return <span className={square ? 'mc-dot sq' : 'mc-dot'} style={{ background: color, boxShadow: ring ? '0 0 0 2px #1a1c20' : undefined }} />
}

function Item({ onClick, active, prefix, title, detail, suffix }: { onClick: () => void; active?: boolean; prefix?: ReactNode; title: ReactNode; detail?: ReactNode; suffix?: ReactNode }) {
  return (
    <li>
      <button className={`mc-item${active ? ' on' : ''}`} onClick={onClick}>
        {prefix && <span className="pre">{prefix}</span>}
        <span className="body"><span className="title">{title}</span>{detail && <span className="detail">{detail}</span>}</span>
        {suffix && <span className="suf">{suffix}</span>}
      </button>
    </li>
  )
}

const Rank = ({ n, big }: { n: number; big?: boolean }) => <span className={big ? 'mc-rank big' : 'mc-rank'}>{n}</span>
const Badge = ({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'positive' | 'neutral' }) => <span className={`mc-badge ${tone}`}>{children}</span>
const Close = ({ onClick, label = '닫기' }: { onClick: () => void; label?: string }) => (
  <button className="mc-icon-btn" aria-label={label} onClick={onClick}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
)

// 고른 학교 카드: 1km 안 가맹점·권유 식당 수와 가까운 권유 식당 바로가기
function SchoolCard({ data, index, R, M, recs, onPick, onClose }: { data: MapData; index: number; R: number; M: Mode; recs: Rec[]; onPick: (d: Rec) => void; onClose: () => void }) {
  const s = data.schools[index]
  const near = recs.filter((d) => d[7] === s.n)
  return (
    <div className="mc-float mc-card">
      <div className="mc-card-head">
        <span className="mc-dot big" style={{ background: s.rc[M][R] > 0 ? 'var(--mc-ask)' : 'var(--mc-covered)' }} />
        <div className="mc-grow"><div className="mc-card-title">{s.n}</div><div className="mc-muted">{s.d} · {s.k}</div></div>
        <Close onClick={onClose} />
      </div>
      <div className="mc-cells">
        <div className="mc-cell"><div className="mc-muted xs">1km 안 가맹점</div><div className="num">{fmt(s.k1[M])}곳</div></div>
        <div className="mc-cell brand"><div className="mc-muted xs">1km 안 권유 식당</div><div className="num brand">{s.rc[M][R]}곳</div></div>
      </div>
      {near.length > 0 && (
        <div className="mc-chips">
          {near.map((d) => <button key={d[5]} onClick={() => onPick(d)}><b>{d[2]}</b> {d[5]}</button>)}
        </div>
      )}
    </div>
  )
}

export default function MealcardApp() {
  const [data, setData] = useState<MapData | null>(null)
  const [R, setR] = useState(100)
  const [M, setM] = useState<Mode>('미포함')
  const [layers, setLayers] = useState<Layers>({ ring: true, schoolRing: true, non: true })
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState('recs')
  const [q, setQ] = useState('')
  const [dong, setDong] = useState<string | null>(null)       // 고른 행정동(없으면 춘천시 전체)
  const [school, setSchool] = useState<number | null>(null)   // 고른 학교(지도에서 그 학교 1km 둘레를 그림)
  const [more, setMore] = useState(false)                     // 동네 탭: 가맹 식당 전체 보기
  const [ctrlOpen, setCtrlOpen] = useState(false)             // 휴대폰: 조건 패널 펼침
  const [drawerOpen, setDrawerOpen] = useState(false)         // 휴대폰: 아래 목록 서랍 펼침
  const mapRef = useRef<MealcardMapHandle>(null)

  useEffect(() => {
    fetch(DATA_URL).then((r) => r.json()).then(setData)
  }, [])

  const recs = useMemo(() => (data ? data.recs.filter((d) => d[0] === M && d[1] === R) : []), [data, M, R])
  const sum = data?.recSummary.find((d) => d.편의점 === M && d.가맹원반경_m === R)
  const bars = data?.recSummary.filter((d) => d.편의점 === M) ?? []
  const barMax = Math.max(1, ...(data?.recSummary.map((d) => d.권유식당) ?? [1]))
  const sel: Rec | undefined = recs.find((d) => d[2] === selected)

  // 동네(행정동)별 식당 수. 권유 식당은 지금 고른 반경·편의점 기준
  const dongStats = useMemo(() => {
    if (!data) return []
    return data.dongs.map((d) => ({
      ...d,
      rec: recs.filter((r) => r[11] === d.c).length,
      non: data.non.filter((p) => p[4] === d.c).length,
      mem: data.members.filter((p) => p[4] === d.c).length,
      school: data.schools.filter((s) => s.g === d.c).length,
    })).sort((a, b) => b.rec - a.rec || b.non - a.non || a.n.localeCompare(b.n, 'ko'))
  }, [data, recs])
  const inDong = useMemo(() => {
    if (!data || !dong) return null
    return {
      name: data.dongs.find((d) => d.c === dong)?.n ?? '',
      recs: recs.filter((r) => r[11] === dong),
      non: data.non.filter((p) => p[4] === dong),
      mem: data.members.filter((p) => p[4] === dong),
    }
  }, [data, dong, recs])

  const openDong = useCallback((c: string) => {
    if (!data) return
    setDong(c)
    setSchool(null)
    setMore(false)
    const pts: [number, number][] = [...data.members, ...data.non].filter((p) => p[4] === c).map((p) => [p[0], p[1]])
    data.schools.filter((s) => s.g === c).forEach((s) => pts.push([s.y, s.x]))
    mapRef.current?.fit(pts)
  }, [data])

  // 학교를 고르면: 그 학교 1km 원이 꽉 차게 이동하고, 1km 둘레의 원·식당 점과 학교 카드를 보여 준다
  const selectSchool = useCallback((i: number) => {
    if (!data || i < 0) return
    const s = data.schools[i]
    setSchool(i)
    setDong(s.g)
    setSelected(null)
    setDrawerOpen(false)
    const dy = data.schoolR / 111320, dx = data.schoolR / (111320 * Math.cos((s.y * Math.PI) / 180))
    mapRef.current?.fit([[s.y - dy, s.x - dx], [s.y + dy, s.x + dx]])
  }, [data])

  const schools = useMemo(() => {
    if (!data) return []
    const k = q.trim()
    return data.schools
      .filter((s) => !k || s.n.includes(k) || s.d.includes(k))
      .sort((a, b) => b.rc[M][R] - a.rc[M][R] || a.n.localeCompare(b.n, 'ko'))
  }, [data, q, M, R])

  const pickRec = useCallback((d: Rec) => {
    setSelected(d[2])
    setSchool(null)
    setDong(d[11])           // 그 식당이 있는 동네의 원·점을 그린다
    setDrawerOpen(false)
    mapRef.current?.focus(d[3], d[4], 3)
  }, [])

  // 반경·편의점을 바꿔 고른 식당이 목록에서 빠지면 선택을 푼다
  const selValid = selected === null || recs.some((d) => d[2] === selected)
  const shownSel = selValid ? sel : undefined

  const backToCity = () => {
    setDong(null)
    setSchool(null)
    if (data) mapRef.current?.fit(data.schools.map((s) => [s.y, s.x]))
  }

  const stats = (
    <div className="mc-stats">
      {[
        { v: sum?.권유식당, l: '권유 식당', brand: true },
        { v: sum?.권유식당있는학교, l: '권유 식당 있는 학교' },
        { v: data?.schools.length, l: '전체 학교' },
      ].map((t) => (
        <div key={t.l} className={t.brand ? 'mc-stat brand' : 'mc-stat'}>
          <div className="v">{t.v ?? '–'}</div>
          <div className="l">{t.l}</div>
        </div>
      ))}
    </div>
  )

  const tabs = (
    <div className="mc-tabs">
      <div className="mc-tablist" role="tablist">
        {([['recs', '권유 식당'], ['dongs', '동네'], ['schools', '학교'], ['info', '정보']] as [string, string][]).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{label}</button>
        ))}
      </div>

      {tab === 'recs' && (
        <div className="mc-panel">
          <p className="mc-note">가장 가까운 가맹점이 먼 순서예요.</p>
          <ul className="mc-list">
            {recs.map((d) => (
              <Item key={`${d[5]}-${d[3]}`} onClick={() => pickRec(d)} active={d[2] === selected}
                prefix={<Rank n={d[2]} />} title={d[5]} detail={`${d[6]} · ${d[7]} ${fmt(d[8])}m`}
                suffix={<Badge>{fmt(d[9])}m</Badge>} />
            ))}
          </ul>
          {recs.length === 0 && <p className="mc-empty">이 기준에서는 권유 식당이 없어요</p>}
        </div>
      )}

      {tab === 'dongs' && (
        <div className="mc-panel">
          <div className="mc-crumb">
            {dong && <button className="mc-icon-btn" aria-label="춘천시로" onClick={backToCity}>‹</button>}
            <button className={dong ? 'muted' : 'strong'} onClick={backToCity}>춘천시</button>
            {inDong && <><span className="muted">›</span><span className="strong">{inDong.name}</span></>}
          </div>

          {!inDong && (
            <ul className="mc-list">
              {dongStats.map((d) => (
                <Item key={d.c} onClick={() => openDong(d.c)} title={d.n}
                  detail={`미가맹 ${fmt(d.non)} · 가맹 ${fmt(d.mem)} · 학교 ${d.school}`}
                  suffix={<>{d.rec > 0 && <Badge>권유 {d.rec}</Badge>}<span className="mc-chev">›</span></>} />
              ))}
            </ul>
          )}

          {inDong && (
            <>
              <h3 className="mc-h3">권유 식당 {inDong.recs.length}곳 (가맹 원 {R}m · 편의점 {M})</h3>
              {inDong.recs.length === 0 && <p className="mc-note">이 동네에는 지금 기준으로 권유 식당이 없어요</p>}
              <ul className="mc-list">
                {inDong.recs.map((d) => (
                  <Item key={`${d[5]}-${d[3]}`} onClick={() => pickRec(d)} prefix={<Rank n={d[2]} />} title={d[5]} detail={`${d[6]} · ${d[7]} ${fmt(d[8])}m`} />
                ))}
              </ul>
              <h3 className="mc-h3">미가맹 식당 {inDong.non.length}곳</h3>
              <ul className="mc-list">
                {inDong.non.map((p) => (
                  <Item key={`${p[2]}-${p[0]}`} onClick={() => mapRef.current?.focus(p[0], p[1], 3)} prefix={<Dot color="var(--mc-non)" />} title={p[2]} detail={p[3]} />
                ))}
              </ul>
              <h3 className="mc-h3">가맹 식당 {fmt(inDong.mem.length)}곳</h3>
              <ul className="mc-list">
                {(more ? inDong.mem : inDong.mem.slice(0, 30)).map((p) => (
                  <Item key={`${p[2]}-${p[0]}-${p[1]}`} onClick={() => mapRef.current?.focus(p[0], p[1], 3)} prefix={<Dot color="var(--mc-member)" />} title={p[2]} detail={p[3]} />
                ))}
              </ul>
              {!more && inDong.mem.length > 30 && (
                <button className="mc-btn" onClick={() => setMore(true)}>가맹 식당 {fmt(inDong.mem.length - 30)}곳 더 보기</button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'schools' && (
        <div className="mc-panel">
          <label className="mc-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교·읍면동 검색" />
          </label>
          <ul className="mc-list">
            {schools.map((s) => (
              <Item key={s.n} onClick={() => selectSchool(data!.schools.indexOf(s))}
                prefix={<Dot square color={s.rc[M][R] > 0 ? 'var(--mc-ask)' : 'var(--mc-covered)'} />}
                title={s.n} detail={`${s.d} · 1km 안 가맹점 ${fmt(s.k1[M])}곳`}
                suffix={s.rc[M][R] > 0 ? <Badge tone="positive">권유 {s.rc[M][R]}</Badge> : undefined} />
            ))}
          </ul>
        </div>
      )}

      {tab === 'info' && (
        <div className="mc-panel mc-info">
          <section>
            <h3 className="mc-h3">가맹 원 반경별 권유 식당 수 (편의점 {M})</h3>
            {bars.map((d) => (
              <button key={d.가맹원반경_m} className={d.가맹원반경_m === R ? 'mc-bar on' : 'mc-bar'} onClick={() => setR(d.가맹원반경_m)}>
                <span className="lab">{d.가맹원반경_m}m</span>
                <span className="track"><span className="fill" style={{ width: `${(d.권유식당 / barMax) * 100}%` }} /></span>
                <span className="val">{d.권유식당}</span>
              </button>
            ))}
          </section>
          <section className="mc-legend">
            <h3 className="mc-h3">범례</h3>
            <div><Dot square color="var(--mc-ask)" />학교: 1km 안에 권유 식당 있음</div>
            <div><Dot square color="var(--mc-covered)" />학교: 권유 식당 없음</div>
            <div><Dot color="var(--mc-member)" />식사형 가맹 식당</div>
            <div><Dot color="var(--mc-cvs)" />편의점 가맹점 (편의점 포함일 때)</div>
            <div><Dot color="var(--mc-non)" />미가맹 식당</div>
            <div><Dot ring color="var(--mc-non)" />가맹 권유 식당</div>
            <div><Dot square color="rgb(98 80 214 / .25)" />춘천시 구역</div>
          </section>
          <section className="mc-small">
            <h3 className="mc-h3">고른 규칙</h3>
            <p>공식 업종이 일반음식점이고 식사형 업태인 곳만 봤어요. 술집·카페·편의점과 상호에 술집·비식당 표현이 있는 곳은 뺐고, 팀이 확인해 8곳을 더 뺐어요.</p>
            <h3 className="mc-h3">출처</h3>
            <p>춘천시 요식업소 현황(공공데이터포털 15003349, 2026-05-27), 춘천시 아동급식카드 가맹점(2026-08-26, 팀 전처리 4,395곳), 상가(상권)정보(15083033, 2026-06), 아동복지급식정보표준데이터(15034530), 초중등학교위치표준데이터(15021148, 2026-10). 춘천시 경계 © OpenStreetMap 기여자(ODbL). 지도 © Kakao. 거리는 직선거리.</p>
          </section>
        </div>
      )}
    </div>
  )


  return (
    <div className="mc">
      <header className="mc-header">
        <span className="mc-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 2a1 1 0 0 1 1 1v6a2 2 0 0 0 1 1.73V21a1 1 0 1 1-2 0V10.73A2 2 0 0 0 6 9V3a1 1 0 0 1 1-1Zm-3 1a1 1 0 0 1 2 0v5H4V3Zm6 0a1 1 0 1 1 2 0v5h-2V3Zm7-1c2.2 0 4 2.69 4 6 0 2.4-.94 4.47-2.3 5.42V21a1 1 0 1 1-2 0v-7.58C15.34 12.47 14.4 10.4 14.4 8c0-3.31 1.4-6 2.6-6Z" /></svg>
        </span>
        <div className="mc-grow">
          <h1>춘천 급식카드 가맹 권유 지도</h1>
          <p>학교 1km 안, 기존 가맹점이 닿지 않는 미가맹 식당</p>
        </div>
        <a className="mc-back" href={import.meta.env.BASE_URL}>← 가맹점 찾기</a>
      </header>

      <main className="mc-main">
        <section className="mc-mapwrap">
          {data ? (
            <MealcardMap ref={mapRef} data={data} R={R} M={M} layers={layers} dong={dong} school={school} onSelectSchool={selectSchool}
              onSelectRec={(rank) => { setSelected(rank); setSchool(null); const r = recs.find((d) => d[2] === rank); if (r) setDong(r[11]) }}
              selectedRank={selected} />
          ) : (
            <div className="mc-map-msg">데이터를 불러오는 중…</div>
          )}

          {/* 조건 패널. 휴대폰에서는 한 줄로 접어 두고 누르면 펼친다 */}
          {!ctrlOpen && (
            <button className="mc-float mc-ctrl-mini" onClick={() => setCtrlOpen(true)}>
              <span className="brand">가맹 원 {R}m</span><span className="mc-muted">·</span><span>편의점 {M}</span><span className="mc-muted xs">바꾸기</span>
            </button>
          )}
          <div className={`mc-float mc-ctrl${ctrlOpen ? ' open' : ''}`}>
            <div className="mc-ctrl-head"><b>조건</b><Close onClick={() => setCtrlOpen(false)} label="조건 닫기" /></div>
            <div className="mc-field">
              <span className="mc-muted xs">가맹 식당 원 반경</span>
              <Seg label="가맹 식당 원 반경" value={String(R)} onChange={(v) => setR(Number(v))}
                items={(data?.radii ?? [100, 200, 300, 400, 500]).map((r) => [String(r), `${r}m`])} />
            </div>
            <div className="mc-field">
              <span className="mc-muted xs">편의점 가맹점</span>
              <Seg label="편의점 가맹점" value={M} onChange={(v) => setM(v as Mode)} items={[['미포함', '미포함'], ['포함', '포함']]} />
            </div>
            <div className="mc-switches">
              <Toggle checked={layers.ring} onChange={(c) => setLayers({ ...layers, ring: c })} label="가맹 원" />
              <Toggle checked={layers.schoolRing} onChange={(c) => setLayers({ ...layers, schoolRing: c })} label="학교 1km" />
              <Toggle checked={layers.non} onChange={(c) => setLayers({ ...layers, non: c })} label="미가맹 식당" />
            </div>
          </div>

          {data && !dong && school === null && !shownSel && (
            <button className="mc-float mc-hint" onClick={() => { setTab('dongs'); setDrawerOpen(true) }}>
              <b className="brand">동네를 고르면</b> <span className="mc-muted">그 동네의 가맹 원과 식당 점이 보여요</span>
            </button>
          )}

          {data && school !== null && !shownSel && (
            <SchoolCard data={data} index={school} R={R} M={M} recs={recs} onPick={pickRec} onClose={() => setSchool(null)} />
          )}

          {/* 선택한 권유 식당 */}
          {shownSel && (
            <div className="mc-float mc-card">
              <div className="mc-card-head">
                <Rank n={shownSel[2]} big />
                <div className="mc-grow"><div className="mc-card-title">{shownSel[5]}</div><div className="mc-muted ellipsis">{shownSel[6]} · {shownSel[10]}</div></div>
                <Close onClick={() => setSelected(null)} />
              </div>
              <div className="mc-cells">
                <div className="mc-cell"><div className="mc-muted xs">가장 가까운 학교</div><div className="strong ellipsis">{shownSel[7]}</div><div className="mono xs">{fmt(shownSel[8])}m</div></div>
                <div className="mc-cell brand"><div className="mc-muted xs">가장 가까운 가맹점</div><div className="num brand">{fmt(shownSel[9])}m</div><div className="mc-muted xs">가맹 원 {R}m 밖</div></div>
              </div>
              <p className="mc-muted sm">학교 1km 안이지만 주변에 카드를 쓸 수 있는 식당이 없는 자리예요. 가맹하면 아이들이 갈 곳이 새로 생겨요.</p>
            </div>
          )}
        </section>

        <aside className="mc-side">
          {stats}
          {tabs}
        </aside>

        {/* 휴대폰: 아래에서 올라오는 목록 서랍. 접으면 요약만, 펼치면 탭과 목록 */}
        <div className={`mc-drawer${drawerOpen ? ' open' : ''}`}>
          <button className="mc-handle" onClick={() => setDrawerOpen(!drawerOpen)} aria-label={drawerOpen ? '목록 접기' : '목록 펼치기'}>
            <span className="bar" />
            <span className="mc-muted xs">{drawerOpen ? '지도 보기' : `권유 식당 ${sum?.권유식당 ?? '–'}곳 목록 보기`}</span>
          </button>
          {stats}
          {drawerOpen && tabs}
        </div>
      </main>
    </div>
  )
}
