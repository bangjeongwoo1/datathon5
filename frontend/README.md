# 잇다(EATDA) 프론트엔드

React·TypeScript·Vite로 구현한 춘천시 아동급식카드 가맹점 찾기와 가맹 권유 지도입니다.

프로젝트 소개, 전체 기능, 백엔드 실행, 데이터 갱신 및 배포 방법은 [프로젝트 README](../README.md)를 참고하세요.

## 실행

이 폴더에 `.env.local`을 만듭니다.

```env
VITE_KAKAO_MAP_APP_KEY=카카오_JavaScript_키
VITE_API_BASE_URL=http://localhost:3001
```

```powershell
npm install
npm run dev
```

카카오 앱의 JavaScript SDK 허용 도메인에 `http://localhost:5173`을 등록합니다.

- 가맹점 찾기: `http://localhost:5173/`
- 가맹 권유 지도: `http://localhost:5173/mealcard.html`
- 음성 인식·도보 거리 조회에는 백엔드도 실행해야 합니다.

## 빌드와 검증

```powershell
node --experimental-strip-types --test tests/*.test.ts
npm run build
npm run preview
```

빌드 결과는 `dist/`에 생성됩니다. Vercel 배포 시 Root Directory는 `frontend`, Build Command는 `npm run build`, Output Directory는 `dist`입니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `src/App.tsx` | 검색·필터·목록·상세 화면 |
| `src/KakaoMap.tsx` | 지도·업종별 마커·군집 |
| `src/kakao.ts` | 카카오 SDK 로딩·타입 정의 |
| `src/merchants.ts`, `src/merchantData.ts` | 가맹점 모델·검색 |
| `src/VoiceSearch.tsx`, `src/voiceIntent.ts` | 녹음·음성 검색어 처리 |
| `src/NearestVoice.tsx` | 현재 위치 기반 도보 거리·음성 안내 |
| `src/apiUrl.ts` | 환경 변수 기반 API 주소 |
| `src/data/merchants.generated.ts` | CSV에서 생성된 가맹점 데이터 |
| `src/mealcard/` | 학교·미가맹 식당·가맹 권유 지도 |
| `public/mealcard/map-data.json` | 가맹 권유 분석 데이터 |

가맹점 데이터는 프로젝트 최상위에서 `python scripts/generate_merchants.py`로 갱신합니다. 카카오 REST API 키는 좌표 보완 스크립트를 실행할 때만 필요합니다.
