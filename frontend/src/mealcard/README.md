# mealcard: 춘천 급식카드 가맹 권유 지도

학교 1km 안에 있는데 기존 가맹점이 닿지 않는 자리의 **미가맹 식당**을 카카오맵에 보여 주는 화면입니다.
Next.js(SEED Design) 버전을 이 프로젝트 스택(React + TypeScript + Vite + 일반 CSS)으로 옮겼습니다.
팀 기존 파일은 고치지 않았고, 아래 새 파일만 추가했습니다.

| 파일 | 내용 |
|---|---|
| `src/mealcard/MealcardApp.tsx` | 화면 전체(헤더, 조건 패널, 요약, 탭: 권유 식당/동네/학교/정보, 식당·학교 카드, 휴대폰 서랍) |
| `src/mealcard/MealcardMap.tsx` | 카카오맵 그리기(춘천시 경계, 학교, 권유 식당, 고른 동네·학교 둘레의 가맹 원·식당 점) |
| `src/mealcard/mealcard.css` | 스타일. 모든 규칙이 `.mc` 아래에만 있어 다른 화면에 영향 없음 |
| `src/mealcard/types.ts` | 데이터 형식 |
| `src/mealcard/preview.tsx`, `mealcard.html` | 미리보기 전용 진입점 (`/mealcard.html`) |
| `public/mealcard/map-data.json` | 지도 데이터(분석 폴더의 `6_코드/지도_만들기.py`가 생성) |

## 미리보기
1. `.env.local`에 `VITE_KAKAO_MAP_APP_KEY=카카오 JavaScript 키`
2. 카카오 디벨로퍼스 → 앱 → JavaScript SDK 도메인에 `http://localhost:5173` 등록
3. `npm run dev` 후 http://localhost:5173/mealcard.html

## 팀 앱에 붙이기
```tsx
import MealcardApp from './mealcard/MealcardApp'
// 원하는 화면(탭, 라우트 등)에서 <MealcardApp /> 를 렌더링
```
- 카카오 SDK는 팀 공용 로더 `src/kakao.ts`의 `loadKakaoMaps`를 그대로 씁니다(같은 키, 한 번만 불러옴).
- `MealcardApp`은 화면 높이 전체(100dvh)를 씁니다. 다른 레이아웃 안에 넣을 때는 `mealcard.css`의 `.mc { height: ... }`를 조정하세요.
- 미리보기 파일(`preview.tsx`, `mealcard.html`)은 연결 후 지워도 됩니다.

## 데이터 출처
춘천시 요식업소 현황(공공데이터포털 15003349, 2026-05-27), 춘천시 아동급식카드 가맹점(2026-08-26, 팀 전처리 4,395곳, 팀 좌표 보완),
상가(상권)정보(15083033, 2026-06), 아동복지급식정보표준데이터(15034530), 초중등학교위치표준데이터(15021148, 2026-10).
춘천시 경계 © OpenStreetMap 기여자(ODbL). 지도 © Kakao.
