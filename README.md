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

## 2. 기술 스택

| 구분 | 기술 |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Map | Kakao Maps |
| Speech-to-Text | Groq API |
| Walking Route | TMAP API |
| Text-to-Speech | Web Speech API |

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
```

백엔드 실행:

```powershell
cd backend
npm.cmd ci
node server.js
```

기본 백엔드 주소: `http://localhost:3001`

### 3-3. 프론트엔드 설정

`frontend/.env.example`을 참고하여 `frontend/.env.local`을 생성합니다.

```dotenv
VITE_KAKAO_MAP_APP_KEY=본인_카카오_JavaScript_키
VITE_API_BASE_URL=http://localhost:3001
```

프론트엔드 실행:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

기본 접속 주소: `http://localhost:5173`

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

지도 및 음성 검색은 프론트엔드에서 불러온 공통 가맹점 데이터를 사용합니다.

### POST /api/menu-ocr

메뉴판 사진 한 장을 분석해 메뉴명과 가격을 JSON으로 돌려줍니다.
**현재 단계는 분석 결과를 반환하는 것까지이고, DB 저장과 화면 연결은 아직 하지 않았습니다.**

```powershell
curl.exe -F "image=@menu.jpg" http://localhost:3001/api/menu-ocr
```

#### 동작 흐름

```text
사진 업로드 → 형식·용량 검사 → Gemini로 메뉴·가격 추출 → 서버에서 가격 재검증 → JSON 반환
```

1. **업로드**: `multipart/form-data`의 `image` 필드로 보냅니다. JPG·PNG·WEBP, 5MB 이하만 받고, 파일 앞부분(매직 바이트)으로 실제 이미지 형식인지도 확인합니다.
2. **호출 제한**: IP당 시간당 10건, 하루 전체 200건입니다. (서버 재시작 시 초기화되는 메모리 방식)
3. **추출**: 서버가 Gemini를 호출합니다. API 키는 서버에만 있습니다. 응답은 JSON 스키마(`name`, `price_text`, `price_won`, `category`, `uncertain`)로 강제하고, 이미지 속 글자는 지시가 아니라 데이터로만 취급하도록 지시합니다.
4. **장애 대응**: 혼잡(503)이면 같은 모델로 최대 2번 재시도합니다. 30초 안에 응답이 없거나(타임아웃) 한도 초과(429)이면 `GEMINI_FALLBACK_MODEL`로 전환합니다.
5. **가격 재검증** (`backend/menuPrice.js`): 사진에 적힌 표기(`price_text`)를 서버가 직접 정수로 바꿉니다.
   - 변환 예: `3000원`, `4,000원`, `1293won`, `1만원`, `만원`, `1만 2천원`, `삼천원`
   - 서버가 계산한 값과 모델이 준 값이 다르면 `uncertain`
   - 500원 미만, 10만 원 초과는 `rejected`
   - 천 원 단위를 소수로 적은 표기(`3.0`, `15.9`, `15.900`, `40,0`)는 `× 1000`으로 계산합니다. 단위가 없는 소수는 원래 모호하므로 **모델이 같은 값을 냈을 때만 `ok`**이고, 모델 값이 없거나 다르면(범위 밖 포함) 사진 속 표기에서 계산한 값을 쓰되 `uncertain`으로 표시합니다.
   - 쉼표 뒤에 1~2자리만 오는 `40,0`은 천 단위 구분이 아니라 소수점으로 읽습니다. (`40,000`은 그대로 40,000원)
   - 그 밖에 단위 없는 100 미만 숫자(예: `9`)는 서버가 해석하지 못하므로 모델 값만으로 `uncertain` 처리
6. **반환**: 검증을 통과한 `items`와 걸러진 `rejected`를 돌려줍니다.

#### 응답 예시

```json
{
  "model": "gemini-3.5-flash-lite",
  "items": [
    { "name": "김치찌개", "price_won": 3000, "price_text": "3000원", "category": "meal", "status": "ok" },
    { "name": "육회", "price_won": 13900, "price_text": "13.9", "category": "meal", "status": "ok" },
    { "name": "꽃문어 코다리찜 (대)", "price_won": 99800, "price_text": "99.8", "category": "meal", "status": "uncertain" }
  ],
  "rejected": []
}
```

- `category`: `meal`(한 끼 식사), `side`(공기밥·사리·반찬), `drink`(음료), `alcohol`(주류). "만원 이하" 필터는 `meal`만 기준으로 합니다. 분류가 없거나 이상하면 `uncertain`입니다.
- `status`: `ok` 또는 `uncertain`. 공개 여부가 아니라 **관리자 검수 우선순위**입니다. 모든 제보는 관리자 승인을 거칩니다.

#### 환경변수 (`backend/.env`)

| 이름 | 설명 |
|---|---|
| `GEMINI_API_KEY` | 필수. Google AI Studio에서 발급 |
| `GEMINI_MODEL` | 사용할 모델. 비우면 `gemini-3.5-flash-lite` |
| `GEMINI_FALLBACK_MODEL` | 선택. 혼잡·타임아웃·한도 초과 시 대신 쓸 모델 |
| `GEMINI_TIMEOUT_MS` | 선택. 호출 1회 제한 시간. 기본 30000 |
| `MENU_PHOTO_DIR` | 선택. 제보 사진 보관 폴더. 기본 `backend/uploads/menu-photos` |

모델 이름은 자주 바뀌므로 `https://generativelanguage.googleapis.com/v1beta/models`에서 현재 사용 가능한 이름을 확인하세요.

#### DB 테이블 (`backend/migrations/001_menu_tables.sql`)

| 테이블·뷰 | 역할 |
|---|---|
| `menu_submissions` | 제보 한 건(사진 한 장)의 OCR 결과와 승인 상태(`pending`/`approved`/`rejected`) |
| `menus` | 관리자가 승인한 확정 메뉴. 지도와 필터는 이 테이블만 봅니다. |
| `merchant_menu_summary` | 가게별 식사(`meal`) 최저가. "만원 이하" 필터용 뷰 |

적용: `cd backend; node migrate.js` (적용한 파일은 건너뛰며, `.env`의 `DB_*`가 가리키는 DB에 적용됩니다.)

### POST /api/merchants/:merchantId/menu-submissions

가게를 지정해 메뉴판 사진을 **제보**합니다. 위의 OCR 결과를 `menu_submissions`에 **검수 대기(`pending`)로 저장**하고, 원본 사진을 비공개 폴더에 보관합니다. 관리자가 승인하기 전에는 지도에 반영되지 않습니다.

```powershell
curl.exe -F "image=@menu.jpg" http://localhost:3001/api/merchants/CC-000001/menu-submissions
```

- 요청: `:merchantId`는 `merchants.merchant_id`, 본문은 `multipart/form-data`의 `image` 필드(JPG·PNG·WEBP, 5MB 이하)
- 성공(201): `submission_id`, `status: "pending"`, `has_uncertain`, `items`, `rejected`, `model`
- 실패: 사진 없음·형식 오류·잘못된 가맹점 번호 `400`, 없는 가맹점 `404`, 메뉴를 읽지 못함 `422`(저장하지 않음), 호출 제한 초과 `429`
- 없는 가맹점은 AI를 호출하기 **전에** 거절하므로 비용이 들지 않습니다.
- 사진은 `backend/uploads/menu-photos/`에 서버가 정한 이름으로 저장됩니다(Git에 올라가지 않음). 관리자가 승인·반려한 뒤 삭제할 예정이며, 폴더는 `MENU_PHOTO_DIR`로 바꿀 수 있습니다.
- DB 저장이 실패하면 방금 저장한 사진도 함께 지웁니다.
- 로그인 기능이 붙기 전에는 제출자(`submitted_by`)가 비어 있습니다.
- **배포 주의**: Render 같은 서버는 재시작 때 파일이 사라지므로, 배포 전에 사진 저장소를 Supabase Storage 등으로 바꿔야 합니다. (`backend/menuSubmissions.js`의 `savePhoto`, `deletePhoto`만 바꾸면 됩니다.)

#### 앞으로 연결할 흐름

```text
지도에서 가게 선택 → 메뉴판 사진 올리기 → OCR → menu_submissions(pending)
   → 관리자 승인 → menus 반영(그 가게 메뉴를 통째로 교체, 이전 기록은 보관)
   → 가게 상세에 메뉴 표시 + "만원 이하 식사 메뉴" 필터
```

남은 작업: 사진 올리기 화면, 관리자 승인 화면(로그인 필요), 메뉴 표시와 필터, 사진 저장소 교체(배포용), Supabase 테이블 적용.

백엔드 테스트: `cd backend; npm.cmd test`

## 5. 데이터 및 기능 관련 주의사항

- 가맹점 데이터는 별도로 제공하는 PostgreSQL 백업 파일에 포함되어 있습니다.
- CSV 원본을 수정해도 PostgreSQL 데이터가 자동 갱신되지는 않습니다.
- DB 변경 사항은 웹페이지 새로고침 또는 지역 재조회 시 반영됩니다.
- 일부 가맹점 좌표는 추정값이며 영업 여부와 카드 사용 가능 여부가 완전히 검증된 것은 아닙니다.
- 메뉴 가격 필터는 별도 개발 예정입니다.
- 술집 판별은 DB 반영 전, `merge_review_targets.py`(업소 원본 + 업종기타 재분류 + 중복의심 검토를 하나로 통합) →
  `naver_merged_scan.py`(네이버 지도에서 업종·영업시간을 조회해 `주점.csv`/`검수필요.csv`/`비주점_업체목록.csv`로 분류)
  순서로 CSV 단계에서 가공합니다. 영업시간 기준의 `midnight_classify.py`는 이와 별도로 운영되는 판별 로직입니다.
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

```
python build_merchant_master.py
```

수집 결과는 업체 1건마다 `가맹점_수집_진행.csv`에 저장되며, 중단했다가 다시 실행하면
이미 처리한 `merchant_id`는 건너뛰고 이어서 진행합니다. `merchant_id`는 4개 지역 CSV를
합친 순서대로 한 번만 배정하므로, 수집 도중에는 4개 지역 CSV를 수정하지 마세요.

### 파일 구성

- `build_merchant_master.py` — 메인 스크립트
- `make_hours_csv.py` / `naver_category.py` — `build_merchant_master.py`가 가져다 쓰는
  크롤링 드라이버 생성, 업종 기반 주점 판별 함수가 들어있는 의존 모듈
- `강릉시.csv` / `원주시.csv` / `춘천시.csv` / `홍천군.csv` — 입력 데이터 (중복·업종기타 처리 완료본)

### 필요 패키지

`selenium`, `webdriver-manager` (Microsoft Edge 드라이버 자동 설치)
