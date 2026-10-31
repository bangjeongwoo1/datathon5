# 잇다(EATDA)

**아이들과 따뜻한 한 끼를 잇는 춘천시 아동급식카드 가맹점 안내 서비스**

잇다(EATDA)는 먹다를 뜻하는 **EAT**과 사람·장소·복지를 연결하는 **잇다**를 결합한 이름입니다. 아동급식카드를 사용할 수 있는 가맹점을 쉽게 찾고, 학교 주변의 급식 접근성을 살펴볼 수 있도록 만든 데이터톤 프로젝트입니다.

로그인이나 카드 등록 없이 가맹점을 검색하고 위치를 확인할 수 있습니다. 음성 검색과 음성 안내를 제공하며, 별도 데이터베이스 없이 정제된 CSV와 분석 결과 JSON을 활용합니다.

## 주요 기능

### 가맹점 찾기

- 가맹점 이름·주소·업종에 포함된 검색어로 매장 검색
- 전체·한식·중식·일식·양식·제과점·편의점·마트 필터
- 왼쪽 검색 목록과 오른쪽 카카오맵으로 구성한 화면
- 업종별 색상 마커, 지도 확대·축소, 매장 선택 및 상세 정보 표시
- 지도 화면 범위에 있는 가맹점만 마커로 생성
- 지도 축소 시 인접 마커를 숫자 군집으로 묶고, 클릭하면 지도 이동 및 해당 묶음의 목록 표시
- 외부 카카오맵 길찾기 연결
- 데스크톱과 모바일에 맞춘 반응형 레이아웃

### 음성 검색·음성 안내

- 마이크로 녹음한 한국어 음성을 Groq Whisper로 텍스트 변환
- “급식카드 가능한 빵집 찾아줘” 같은 표현에서 업종을 추출해 필터 적용
- 지원하는 음식 키워드는 가맹점명·주소 등의 문자열 검색에 사용 — 실제 메뉴 데이터 검색은 아님
- 브라우저 `speechSynthesis`로 검색 결과 수 읽기
- 브라우저 위치 권한을 받아 현재 위치 기준 도보 거리 조회
- 직선거리로 가까운 후보 최대 16곳을 추린 뒤 TMAP 보행자 경로로 비교하고 결과를 음성 안내

도보 안내는 **경로 조회에 성공한 후보 중 가장 가까운 매장**을 안내합니다. 전체 가맹점의 도보 경로를 모두 비교하는 방식은 아닙니다.

### 가맹 권유 지도

`/mealcard.html`에서 학교 주변의 가맹점 접근성과 가맹 확대를 검토할 미가맹 식당을 확인합니다.

- 춘천시 경계·학교·가맹 식당·편의점·미가맹 식당·가맹 권유 식당 표시
- 학교 주변 1km 범위와 가맹 식당 반경 조건 확인
- 가맹 식당 반경 및 편의점 포함 여부 변경
- 동네·학교·권유 식당별 목록과 요약 통계
- 지도 레이어 켜기·끄기 및 선택한 학교·식당 위치 이동

저장된 분석 결과를 조건별로 조회하는 기능이며, 실제 가맹 등록을 신청하거나 승인하는 기능은 아닙니다.

## 기술 구성

| 구분 | 사용 기술 |
| --- | --- |
| 프론트엔드 | React, TypeScript, Vite, HTML, CSS |
| 백엔드 | Node.js, Express, Multer, dotenv |
| 지도 | 카카오맵 JavaScript SDK, 마커 클러스터러 |
| 음성 인식 | Groq SDK, Whisper `whisper-large-v3-turbo` |
| 음성 출력·위치 | Speech Synthesis, Geolocation, MediaRecorder |
| 도보 거리 | TMAP 보행자 경로 API |
| 데이터 | CSV, 정적 JSON, Python 데이터 생성 스크립트 |
| 좌표 보완 | 카카오 로컬 REST API — 전처리에서만 사용 |
| 배포 구성 | 프론트엔드 Vercel, 백엔드 Render |

## 프로젝트 구조

```text
datathon5/
├─ frontend/
│  ├─ src/
│  │  ├─ App.tsx                  # 검색·필터·목록·상세 화면
│  │  ├─ KakaoMap.tsx             # 지도·마커·군집
│  │  ├─ VoiceSearch.tsx          # 녹음·음성 검색
│  │  ├─ NearestVoice.tsx         # 도보 거리·음성 안내
│  │  ├─ voiceIntent.ts           # 음성 검색어·업종 해석
│  │  ├─ apiUrl.ts                # 백엔드 API 주소
│  │  ├─ data/merchants.generated.ts
│  │  └─ mealcard/                # 가맹 권유 지도
│  ├─ public/mealcard/map-data.json
│  ├─ tests/
│  ├─ index.html
│  └─ mealcard.html
├─ backend/server.js             # 음성 인식·도보 거리 API
├─ data/                         # 원본·전처리·좌표 보완 데이터
├─ scripts/                      # 좌표 보완 및 프론트 데이터 생성
└─ docs/                         # 개발 관련 문서
```

## 로컬 실행 방법

### 1. 준비

- Node.js 24.x와 npm — 개발 환경에서 사용한 버전 계열
- 카카오 JavaScript 키
- Groq API 키 — 백엔드 시작에 필수
- TMAP 앱 키 — 도보 거리 기능 사용 시 필요
- Python 3.10 이상 — 가맹점 데이터를 다시 생성할 때만 필요

프론트와 백엔드는 각각 의존성을 설치하고 **터미널 두 개에서 따로 실행**합니다. 저장된 데이터가 포함되어 있으므로 일반 실행 전에 전처리를 다시 할 필요는 없습니다.

### 2. 프론트 환경 변수

`frontend/.env.local`을 만들고 아래 값을 입력합니다.

```env
VITE_KAKAO_MAP_APP_KEY=카카오_JavaScript_키
VITE_API_BASE_URL=http://localhost:3001
```

카카오 개발자 콘솔에서 지도 사용 설정을 확인하고, JavaScript SDK 허용 도메인에 `http://localhost:5173`을 등록합니다. 다른 포트나 배포 도메인으로 접속한다면 실제 접속 주소도 등록해야 합니다.

`VITE_` 접두사는 브라우저에서 환경 변수를 읽기 위해 필요합니다. Groq·TMAP·카카오 REST 키에는 이 접두사를 붙이지 않습니다.

### 3. 백엔드 환경 변수 및 실행

`backend/.env`를 만듭니다.

```env
GROQ_API_KEY=Groq_API_키
TMAP_APP_KEY=TMAP_앱_키
FRONTEND_URL=http://localhost:5173
PORT=3001
```

프로젝트 최상위에서 첫 번째 터미널을 열어 실행합니다.

```powershell
cd backend
npm install
node server.js
```

현재 백엔드에는 `npm start` 스크립트가 없으므로 `node server.js`로 실행합니다. Groq 키가 없으면 서버가 시작되지 않으며, TMAP 키가 없으면 도보 경로 조회만 사용할 수 없습니다.

`http://localhost:3001/health`에서 아래 응답을 확인합니다.

```json
{"message":"STT 서버 정상 작동"}
```

### 4. 프론트 실행

프로젝트 최상위에서 두 번째 터미널을 열어 실행합니다.

```powershell
cd frontend
npm install
npm run dev
```

- 가맹점 찾기: `http://localhost:5173/`
- 가맹 권유 지도: `http://localhost:5173/mealcard.html`

지도·정적 데이터 검색은 프론트만 실행해도 사용할 수 있습니다. 음성 인식과 도보 경로 조회에는 백엔드가 필요합니다. 마이크·위치 기능은 브라우저 권한이 필요하며, 배포 환경에서는 HTTPS로 접속합니다.

Windows PowerShell에서 npm 실행 정책 오류가 발생하면 `npm` 대신 `npm.cmd`를 사용합니다.

## 백엔드 API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버 상태 확인 |
| POST | `/api/stt` | `multipart/form-data`의 `audio` 파일을 텍스트로 변환. 최대 20MB |
| POST | `/api/walking-nearest` | JSON의 `lat`, `lng`, `stores`로 도보 거리 후보 비교 |

음성 파일은 백엔드 메모리에서 처리한 후 Groq에 전달합니다. 도보 경로 조회 시 현재 위치와 후보 매장 좌표는 TMAP에 전달됩니다.

## 데이터 구성과 갱신

별도 DB 서버를 사용하지 않습니다. 정제된 CSV를 TypeScript 정적 데이터로 생성해 검색 화면에 포함하고, 가맹 권유 지도는 `frontend/public/mealcard/map-data.json`을 읽습니다.

주요 자료는 춘천시 아동급식카드 가맹점, 요식업소 현황, 상가·상권 정보, 아동복지급식정보 및 학교 위치 데이터입니다. 가맹 권유 지도의 자세한 출처는 [관련 문서](frontend/src/mealcard/README.md)를 참고하세요. 두 화면은 각각의 데이터 파일을 사용하므로 수록 범위와 건수가 다를 수 있습니다.

### CSV 변경 후 프론트 데이터 생성

프로젝트 최상위에서 실행합니다.

```powershell
python scripts/generate_merchants.py
```

- `data/`의 `A_`로 시작하는 좌표 통합 CSV를 읽으며, `_보완.csv`가 있으면 우선 사용합니다.
- 결과는 `frontend/src/data/merchants.generated.ts`에 생성됩니다.
- Python 표준 라이브러리만 사용하므로 별도 `pip install`은 필요 없습니다.
- 생성 후 다시 빌드·배포해야 데이터가 반영됩니다.

### 좌표 누락 주소 보완 — 선택 작업

`frontend/.env.local`에 전처리용 키를 추가합니다.

```env
KAKAO_REST_API_KEY=카카오_REST_API_키
```

```powershell
node --env-file=frontend/.env.local scripts/geocode_missing_coordinates.mjs
python scripts/generate_merchants.py
```

기존 좌표는 유지하고 누락 행에 주소·상호명 검색을 시도해 `_보완.csv`를 만듭니다. 좌표가 끝내 확인되지 않는 매장은 지도 마커에서 제외합니다. REST 키는 전처리용이므로 Vercel에 등록할 필요가 없습니다.

## 빌드와 테스트

```powershell
cd frontend
node --experimental-strip-types --test tests/*.test.ts
npm run build
npm run preview
```

`frontend/dist`에 두 화면이 함께 빌드됩니다. 좌표 보완 테스트는 프로젝트 최상위에서 실행합니다.

```powershell
node --test scripts/geocode_missing_coordinates.test.mjs
```

## 배포 설정

| 설정 | Vercel — 프론트 | Render — 백엔드 |
| --- | --- | --- |
| Root Directory | `frontend` | `backend` |
| 실행 환경 | Vite | Node |
| Build Command | `npm run build` | `npm install` |
| Output Directory | `dist` | 해당 없음 |
| Start Command | 해당 없음 | `node server.js` |
| 환경 변수 | `VITE_KAKAO_MAP_APP_KEY`, `VITE_API_BASE_URL` | `GROQ_API_KEY`, `TMAP_APP_KEY`, `FRONTEND_URL` |

- `VITE_API_BASE_URL`에는 Render HTTPS 주소만 입력합니다. `/health`나 `/api` 경로는 붙이지 않습니다.
- `FRONTEND_URL`에는 실제 Vercel 접속 주소를 넣어 CORS를 허용합니다.
- Render가 제공하는 `PORT`를 사용하므로 배포 시 포트를 직접 지정할 필요가 없습니다.
- 카카오 앱에도 실제 프론트 배포 주소를 허용 도메인으로 등록합니다.
- 프론트 환경 변수 변경 후에는 새로 빌드·배포해야 합니다.
- `.env`, `.env.local`, `node_modules`는 Git에 올리지 않습니다.

## 이용 시 참고 사항

- 실시간 영업·배달 여부·전화번호·추천 메뉴 데이터는 연결되어 있지 않습니다. 현재 화면에 남은 관련 예시 표시는 실제 정보로 해석하면 안 됩니다.
- 검색은 저장된 가맹점 문자열을 대상으로 합니다. 임의의 건물명을 검색해 그 위치로 이동하는 장소 검색은 제공하지 않습니다.
- 학교 주변 분석의 반경·거리는 직선거리이며, TMAP 도보 경로 거리와 다릅니다.
- 데이터는 수집·전처리 시점 기준이므로 방문 전 실제 가맹 여부와 이용 조건을 확인해 주세요.
