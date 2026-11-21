# 잇다 (EATDA)

아동급식카드 이용자를 위한 지역별 가맹점 검색 및 도보 경로 안내 서비스입니다.

## 1. 이번 업그레이드 내용

### 지역 확장
- 기존 춘천시 중심 서비스에서 원주시, 강릉시, 홍천군 추가
- 총 4개 지역 지원
- 지역 선택에 따른 지도 및 가맹점 목록 변경

### PostgreSQL 기반 동적 데이터 조회
- 기존 프론트엔드 정적 데이터 조회 방식을 PostgreSQL 기반 조회 방식으로 변경
- 총 10,914건의 가맹점 데이터 구축
- Express API를 통한 가맹점 검색 및 지역별 조회
- DB 데이터 추가·수정 후 재조회하면 프론트엔드에 반영

### 기존 기능 연동
- 카카오 지도에 DB 기반 가맹점 표시
- 업종 필터 및 검색
- Groq STT 음성 검색
- TMAP 도보 경로 조회
- 지도와 음성 검색에서 동일한 가맹점 데이터 사용
- 데이터 로딩 실패 시 오류 표시 및 재시도 기능

### 메뉴판 사진 제보와 "만원 이하 식사" 필터
- 메뉴판 사진을 올리면 AI가 메뉴·가격을 읽고 관리자가 검수·승인
- 승인된 메뉴 기준으로 "만원 이하 식사" 필터와 표시
- 구글 로그인(Supabase Auth)과 관리자 전용 검수 화면

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| `frontend/` | React 화면(첫 화면, 가맹점 지도, 음성 길 안내, 관리자 검수). [frontend/README.md](frontend/README.md) |
| `backend/` | Express API 서버. [backend/README.md](backend/README.md), 음성 길 안내 API는 [backend/NAVIGATION.md](backend/NAVIGATION.md) |
| `data/` | 원본 공공데이터·좌표 통합 CSV와 전처리 노트북 |
| `data/주점판별/` | 술집 판별용 4개 지역 CSV와 검토 CSV(7번 스크립트의 입력·출력) |
| `scripts/` | 데이터 가공 스크립트(가맹점 생성, 좌표 보완, 술집 판별) |
| `tools/` | 로컬 음성 실험 실행기, 전화번호 열 진단 SQL |
| `mealcard_data/` | 가맹 권유 지도 데이터와 코드(자체 폴더 구조 그대로 사용) |
| `docs/` | API 문서와 설계 기록 |

## 2. 기술 스택

| 구분 | 기술 |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Map | Kakao Maps |
| Auth | Supabase Auth (구글 로그인) |
| Menu OCR | Gemini API |
| Speech-to-Text | Groq API |
| Walking Route | TMAP API |
| Text-to-Speech | Google Cloud TTS(Chirp), 실패·비활성 시 Web Speech API |

## 3. 프로젝트 실행 방법

### 3-1. PostgreSQL 설정

PostgreSQL 설치 후 `itda` 데이터베이스를 생성합니다.

별도로 전달된 `itda.backup` 파일을 pgAdmin의 **Restore** 기능으로 복원합니다.

복원 후 다음 SQL로 데이터 건수를 확인할 수 있습니다.

```sql
SELECT COUNT(*) FROM public.merchants;
```

백업 기준 총 10,914건입니다.

### 3-2. 백엔드 설정

`backend/.env.example`을 복사하여 `backend/.env` 파일을 생성합니다.

```dotenv
PORT=3001
FRONTEND_URL=http://localhost:5173

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=본인_PostgreSQL_비밀번호
DB_NAME=itda

GROQ_API_KEY=본인_Groq_API_키
TMAP_APP_KEY=본인_TMAP_API_키

# 메뉴판 OCR·로그인·관리자 (자세한 설명은 backend/README.md)
GEMINI_API_KEY=본인_Gemini_API_키
SUPABASE_URL=https://프로젝트ref.supabase.co
SUPABASE_ANON_KEY=본인_Supabase_anon_키
ADMIN_EMAILS=관리자_이메일
```

백엔드 실행:

```powershell
cd backend
npm.cmd ci
node --env-file=.env server.js
```

기본 백엔드 주소: `http://localhost:3001`

### 3-3. 프론트엔드 설정

`frontend/.env.example`을 참고하여 `frontend/.env.local`을 생성합니다.

```dotenv
VITE_KAKAO_MAP_APP_KEY=본인_카카오_JavaScript_키
VITE_API_BASE_URL=http://localhost:3001
VITE_SUPABASE_URL=https://프로젝트ref.supabase.co
VITE_SUPABASE_ANON_KEY=본인_Supabase_anon_키
```

프론트엔드 실행:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

기본 접속 주소: `http://localhost:5173` (첫 화면). 가맹점 지도는 `/finder.html`, 가맹 권유 지도는 `/mealcard.html`, 관리자 검수는 `/admin.html`입니다.

카카오 지도 API 키의 허용 도메인 설정도 확인해야 합니다.

## 4. 주요 API

### GET /api/merchants

PostgreSQL에 저장된 가맹점을 조회합니다.

예시:

```text
GET http://localhost:3001/api/merchants?region=춘천시&limit=1000&offset=0
```

주요 파라미터:
- `region`: 조회 지역
- `search`: 검색어
- `limit`: 조회 개수
- `offset`: 조회 시작 위치

각 가맹점에는 관리자가 승인한 메뉴판 기준의 `in_under_10000`(`Y`/`N`/없음)과 `min_meal_price_won`(식사 최저가)이 함께 들어갑니다.

지도 및 음성 검색은 프론트엔드에서 불러온 공통 가맹점 데이터를 사용합니다.

### 메뉴판 사진 제보와 관리자 검수

지도에서 가게를 고르고 메뉴판 사진을 올리면 AI(Gemini)가 메뉴와 가격을 읽고, **관리자가 승인한 메뉴만** 지도에 반영됩니다. 승인된 메뉴로 가게마다 "만원 이하 식사" 여부(Y/N/모름)를 계산해 필터로 씁니다.

```text
지도에서 가게 선택 → 메뉴판 사진 올리기 → OCR → 검수 대기(pending)
   → 관리자 승인(/admin.html) → 기존 메뉴에 추가(기본) 또는 통째로 교체
   → "만원 이하 식사" 필터와 카드 표시
```

| 주소 | 권한 | 하는 일 |
|---|---|---|
| `POST /api/menu-ocr` | 누구나 | 사진 분석만(저장 안 함) |
| `POST /api/merchants/:merchantId/menu-submissions` | 누구나 | 사진 제보(검수 대기로 저장) |
| `GET /api/me` | 로그인 | 내 정보와 관리자 여부 |
| `/api/admin/*` | 관리자 | 제보 목록·상세·사진·승인·반려 |

- 서버 동작(가격 검증, 분류 규칙, 승인 방식, DB 테이블, 환경변수, 로그인 확인)은 [backend/README.md](backend/README.md)
- 화면(사진 올리기, 만원 이하 필터, 관리자 검수 화면)은 [frontend/README.md](frontend/README.md)
- 사용하려면 `backend/.env`에 `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`를, `frontend/.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣고, `cd backend; node migrate.js`로 테이블을 만듭니다.

## 5. 데이터 및 기능 관련 주의사항

- 가맹점 데이터는 별도로 제공하는 PostgreSQL 백업 파일에 포함되어 있습니다.
- CSV 원본을 수정해도 PostgreSQL 데이터가 자동 갱신되지는 않습니다.
- DB 변경 사항은 웹페이지 새로고침 또는 지역 재조회 시 반영됩니다.
- 일부 가맹점 좌표는 추정값이며 영업 여부와 카드 사용 가능 여부가 완전히 검증된 것은 아닙니다.
- 메뉴 가격 필터는 별도 개발 예정입니다.
- 술집 판별은 DB 반영 전, `scripts/merge_review_targets.py`(업소 원본 + 업종기타 재분류 + 중복의심 검토를 하나로 통합) →
  `scripts/naver_merged_scan.py`(네이버 지도에서 업종·영업시간을 조회해 `주점.csv`/`검수필요.csv`/`비주점_업체목록.csv`로 분류)
  순서로 CSV 단계에서 가공합니다. 영업시간 기준의 `scripts/midnight_classify.py`는 이와 별도로 운영되는 판별 로직입니다.
  입력·출력 CSV는 모두 `data/주점판별/`에 있습니다. 단, `merge_review_targets.py`가 읽는 `A_지도용_검토상태포함.csv`는 저장소에 없으므로 따로 받아 그 폴더에 넣어야 합니다.
- DB 비밀번호와 실제 API 키는 GitHub에 업로드하지 않습니다.

## 6. 프로젝트 협업

이번 작업은 `feature/region-db-upgrade` 브랜치에서 진행했습니다.

주요 변경 사항은 **4개 지역 확장, PostgreSQL 데이터베이스 구축, Express 가맹점 API 개발 및 기존 지도·음성 기능 연동**입니다.

추가 기능 개발 후 Pull Request를 통해 팀 프로젝트의 `main` 브랜치에 병합할 수 있습니다.

## 7. 4개 지역 가맹점 주점/비주점 분류 (데이터 처리 스크립트)

강릉시 / 원주시 / 춘천시 / 홍천군 가맹점 CSV를 하나로 합친 뒤, 네이버 지도에서
업종과 요일별(평일/토/일/배달) 영업시간을 수집해 `주점.csv` / `비주점.csv` /
`검수필요.csv` 세 파일로 분류합니다.

### 실행

```powershell
python scripts/build_merchant_master.py
```

스크립트는 `scripts/`에, 입력·출력 CSV는 `data/주점판별/`에 있습니다(어느 폴더에서 실행해도 같은 위치를 씁니다). 검토용 `A_*.csv`를 `data/` 바로 아래에 두면 `scripts/generate_merchants.py`가 가맹점 원본으로 잘못 읽을 수 있어 하위 폴더로 분리했습니다.

수집 결과는 업체 1건마다 `data/주점판별/가맹점_수집_진행.csv`에 저장되며, 중단했다가 다시 실행하면
이미 처리한 `merchant_id`는 건너뛰고 이어서 진행합니다. `merchant_id`는 4개 지역 CSV를
합친 순서대로 한 번만 배정하므로, 수집 도중에는 4개 지역 CSV를 수정하지 마세요.

### 파일 구성

- `scripts/build_merchant_master.py` — 메인 스크립트
- `scripts/make_hours_csv.py` / `scripts/naver_category.py` — `build_merchant_master.py`가 가져다 쓰는
  크롤링 드라이버 생성, 업종 기반 주점 판별 함수가 들어있는 의존 모듈
- `scripts/dedup_review.py` — `A_중복의심_검토.csv`의 중복 확인·제거(애매한 건은 사람 검수용 파일로 분리)
- `data/주점판별/강릉시.csv` / `원주시.csv` / `춘천시.csv` / `홍천군.csv` — 입력 데이터 (중복·업종기타 처리 완료본)
- `data/주점판별/A_*.csv`, `중복의심_검토_완료.csv` — 업종기타 재분류·주점 후보·중복 의심 검토 자료

### 필요 패키지

`selenium`, `webdriver-manager` (Microsoft Edge 드라이버 자동 설치)
