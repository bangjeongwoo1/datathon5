// 첫 화면 카드의 그림. 외부 이미지를 쓰지 않고 SVG 로 직접 그렸다. (장식용이라 스크린리더에서는 숨긴다.)

const GREEN = '#139a58' // 로고의 초록
const ORANGE = '#f7971d' // 로고의 주황

/** 식당 핀: 물방울 모양 핀 안에 숟가락·젓가락 느낌의 선을 넣었다. */
function Pin({ x, y, color = GREEN, scale = 1 }: { x: number; y: number; color?: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <ellipse cx="0" cy="2" rx="9" ry="3" fill="#0f172a" opacity="0.12" />
      <path d="M0 0C-15-18-17-24-17-31a17 17 0 0 1 34 0c0 7-2 13-17 31Z" fill={color} />
      <circle cx="0" cy="-31" r="11" fill="#fff" />
      <path d="M-4-37v8M0-37v8M4-37v8M-4-33h8" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
    </g>
  )
}

/** 가맹점 지도: 길과 건물이 있는 작은 지도 위에 가맹점 핀이 흩어져 있다. */
export function MapIllustration() {
  return (
    <svg viewBox="0 0 360 260" role="presentation" aria-hidden="true" focusable="false">
      <rect width="360" height="260" rx="18" fill="#eef3f8" />
      {/* 공원과 강 */}
      <path d="M236 0h124v92c-44-6-70-34-72-60-1-14-22-24-52-32Z" fill="#d9efe2" />
      <path d="M0 196c60-22 112 8 168-8s100-52 192-34v106H0Z" fill="#dbe9f7" />
      {/* 건물 */}
      <g fill="#e1e8f1">
        <rect x="28" y="32" width="64" height="44" rx="6" />
        <rect x="112" y="24" width="52" height="60" rx="6" />
        <rect x="44" y="100" width="48" height="52" rx="6" />
        <rect x="120" y="108" width="70" height="38" rx="6" />
        <rect x="214" y="112" width="52" height="46" rx="6" />
      </g>
      {/* 길 */}
      <g stroke="#fff" strokeWidth="11" strokeLinecap="round" fill="none">
        <path d="M0 92h360" />
        <path d="M104 0v196" />
        <path d="M200 0v150" />
        <path d="M0 170l150-16 210 20" />
      </g>
      <Pin x={64} y={74} />
      <Pin x={156} y={64} />
      <Pin x={304} y={156} />
      <Pin x={92} y={160} />
      {/* 눈에 띄는 핀과 말풍선 */}
      <g transform="translate(250 86)">
        <rect x="-62" y="-72" width="124" height="30" rx="15" fill={ORANGE} />
        <text x="0" y="-52" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="'Noto Sans KR','Malgun Gothic',sans-serif">
          급식카드 가능
        </text>
        <path d="M-6-42h12l-6 9Z" fill={ORANGE} />
      </g>
      <Pin x={250} y={106} color={ORANGE} scale={1.15} />
      {/* 내 위치 */}
      <circle cx="170" cy="122" r="14" fill="#2563eb" opacity="0.18" />
      <circle cx="170" cy="122" r="7" fill="#2563eb" stroke="#fff" strokeWidth="3" />
    </svg>
  )
}

/** 가맹 권유 지도: 학교를 중심으로 한 원 안팎에 식당 핀이 있고, 한 곳에 "가맹 권유" 표시가 붙는다. */
export function MealcardIllustration() {
  return (
    <svg viewBox="0 0 320 260" role="presentation" aria-hidden="true" focusable="false">
      <rect width="320" height="260" rx="18" fill="#f3f7f2" />
      <circle cx="160" cy="132" r="104" fill="#e3f3ea" stroke={GREEN} strokeWidth="2.5" strokeDasharray="7 7" />
      {/* 학교 */}
      <g transform="translate(160 128)">
        <rect x="-44" y="-10" width="88" height="46" rx="4" fill="#fff" stroke="#c9d4e3" strokeWidth="2" />
        <path d="M-52-8L0-38l52 30Z" fill="#2563eb" />
        <rect x="-8" y="8" width="16" height="28" rx="2" fill="#93b8fd" />
        <g fill="#cfe0fb">
          <rect x="-36" y="2" width="14" height="14" rx="2" />
          <rect x="22" y="2" width="14" height="14" rx="2" />
        </g>
        <path d="M0-38v-22" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M0-60h20l-5 7 5 7H0Z" fill={ORANGE} />
      </g>
      <Pin x={72} y={88} color="#9aa7b8" scale={0.9} />
      <Pin x={246} y={96} color="#9aa7b8" scale={0.9} />
      <Pin x={92} y={206} color="#9aa7b8" scale={0.9} />
      {/* 아직 가맹하지 않은 식당(권유 대상) */}
      <Pin x={238} y={204} color={ORANGE} scale={1.1} />
      <g transform="translate(238 166)">
        <circle r="14" fill={GREEN} stroke="#fff" strokeWidth="3" />
        <path d="M-6 0h12M0-6v12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="translate(160 244)">
        <rect x="-60" y="-14" width="120" height="24" rx="12" fill="#fff" stroke="#d6dee9" />
        <text x="0" y="3" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" fontFamily="'Noto Sans KR','Malgun Gothic',sans-serif">
          학교 1km 안
        </text>
      </g>
    </svg>
  )
}
