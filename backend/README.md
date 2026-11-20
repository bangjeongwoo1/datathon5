# 잇다(EATDA) 백엔드

Node.js·Express(ESM) 서버입니다. 가맹점 조회, 음성 검색(Groq), 도보 경로(TMAP), 메뉴판 사진 OCR·제보·관리자 검수, 로그인 확인을 맡습니다.
프로젝트 전체 소개와 DB 복원 방법은 [프로젝트 README](../README.md)를 참고하세요.

## 실행

```powershell
cd backend
npm.cmd ci
node --env-file=.env server.js
```

기본 주소는 `http://localhost:3001`입니다. `.env`는 `.env.example`을 복사해 만들고, **서버를 켤 때 한 번만 읽으므로 고친 뒤에는 서버를 껐다 켜야 합니다.**

### 환경변수 (`backend/.env`)

| 이름 | 설명 |
|---|---|
| `PORT`, `FRONTEND_URL` | 서버 포트, 프론트 주소(CORS) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` | PostgreSQL 접속. Supabase는 transaction pooler(포트 6543)를 쓰고 `DB_SSL=true` |
| `GROQ_API_KEY`, `TMAP_APP_KEY` | 음성 검색, 도보 경로 |
| `GEMINI_API_KEY` | 메뉴판 OCR용. Google AI Studio에서 발급 |
| `GEMINI_MODEL` | 사용할 모델. 비우면 `gemini-3.5-flash-lite` |
| `GEMINI_FALLBACK_MODEL` | 선택. 혼잡·타임아웃·한도 초과 시 대신 쓸 모델 |
| `GEMINI_TIMEOUT_MS` | 선택. 호출 1회 제한 시간. 기본 30000 |
| `OCR_LIMIT_PER_IP_PER_HOUR`, `OCR_LIMIT_PER_DAY` | 선택. 사진 분석 호출 제한. 기본 IP당 시간당 10건, 하루 전체 200건. 데이터를 한꺼번에 넣어 볼 때만 로컬에서 늘리고, 비용의 상한이므로 배포 서버는 비워 둡니다 |
| `MENU_PHOTO_DIR` | 선택. 제보 사진 보관 폴더. 기본 `backend/uploads/menu-photos` |
| `MERCHANT_SOURCE_TABLE` | 선택. 제보에서 가게 번호를 확인할 가게 목록 표. 기본 `merchant_crawl_staging`. staging 표가 없는 옛 로컬 DB에서만 `merchants`로 바꿉니다 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | 로그인 확인용. 프론트 `.env.local`의 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`와 같은 공개 값(`service_role` 키는 넣지 않음). 값 앞에 변수 이름이 중복으로 붙지 않게 주의 |
| `ADMIN_EMAILS` | 관리자 이메일(쉼표로 구분). 비워 두면 아무도 관리자가 아닙니다 |

모델 이름은 자주 바뀌므로 `https://generativelanguage.googleapis.com/v1beta/models`에서 현재 사용 가능한 이름을 확인하세요.

## 테스트

```powershell
cd backend
npm.cmd test
```

## API 한눈에 보기

| 주소 | 권한 | 하는 일 |
|---|---|---|
| `GET /api/merchants` | 누구나 | 가맹점 조회. 승인된 메뉴 기준 `in_under_10000`, `min_meal_price_won` 포함 |
| `POST /api/menu-ocr` | 누구나 | 메뉴판 사진 분석만(저장 안 함) |
| `POST /api/merchants/:merchantId/menu-submissions` | 누구나(로그인하면 제출자 기록) | 메뉴판 사진 제보(검수 대기로 저장) |
| `GET /api/me` | 로그인 | 내 정보와 관리자 여부 |
| `/api/admin/*` | 관리자 | 제보 목록·상세·사진·승인·반려 |

## GET /api/merchants

PostgreSQL에 저장된 가맹점을 조회합니다. 파라미터는 `region`(지역), `search`(검색어), `limit`, `offset`입니다.

```text
GET http://localhost:3001/api/merchants?region=춘천시&limit=1000&offset=0
```

각 가맹점에는 관리자가 승인한 메뉴판 기준의 `in_under_10000`(`Y`/`N`/없음)과 `min_meal_price_won`(식사 최저가)이 함께 들어갑니다. (`merchant_menu_summary` 뷰, 아래 "DB 테이블" 참고)
**가게 정보의 메인 테이블은 `merchant_crawl_staging`입니다.** (옛 `merchants`, `merchant_naver_info`는 더 읽지 않습니다.) 쿼리는 `merchantList.js`에 있고, 이 표의 열 이름과 글자로 저장된 값을 화면이 쓰는 모양으로 바꿔 내려줍니다.

| 응답 항목 | 원본(`merchant_crawl_staging`) |
|---|---|
| `merchant_id` | `merchant_id` (숫자 글자, 예 `"2441"`) |
| `region`, `name`, `address` | `signguNm`, `mrhstNm`, `rdnmadr`(없으면 `lnmadr`) |
| `latitude`, `longitude` | 글자로 저장된 좌표를 숫자로 변환(숫자가 아니면 비움) |
| `category` | `Cuisine`으로 만든 큰 분류: 편의점, 마트·슈퍼, 반찬·식품, 제과·간식, 기타, 음식점. `Cuisine`이 비면(판별불가) 미분류 |
| `phone` | `phoneNumber`. `000-0000-0000`처럼 0과 하이픈뿐인 값은 번호 없음(null) |
| `naver_cuisine`, `naver_classification`, `address_check` | `Cuisine`, `네이버기반판별`, `주소확인` |
| `weekday_*`, `saturday_*`, `holiday_*` | 평일·토요일·**공휴일** 영업시간(원본에는 일요일이 없습니다) |
| `in_under_10000`, `min_meal_price_won`, `confirmed_meals` | 승인된 메뉴 기준 판정과 확정 식사 메뉴 |

판별불가·주점의심 가게도 데이터 그대로 포함합니다(크롤링으로 갱신할 예정이라 거르는 규칙을 두지 않았습니다). 정렬은 번호 순입니다.

## 전체 흐름

```text
지도에서 가게 선택 → 메뉴판 사진 올리기 → OCR → menu_submissions(pending)
   → 관리자 승인(/admin.html) → menus 반영(그 가게 메뉴를 통째로 교체, AI 원본 결과는 제보에 보관)
   → "만원 이하 식사" 필터와 카드 표시
```

## POST /api/menu-ocr

메뉴판 사진 한 장을 분석해 메뉴명과 가격을 JSON으로 돌려줍니다. 이 주소는 저장하지 않습니다. 실제 화면은 아래 `menu-submissions` 주소로 제보합니다.

```powershell
curl.exe -F "image=@menu.jpg" http://localhost:3001/api/menu-ocr
```

```text
사진 업로드 → 형식·용량 검사 → Gemini로 메뉴·가격 추출 → 서버에서 가격 재검증 → JSON 반환
```

1. **업로드**: `multipart/form-data`의 `image` 필드로 보냅니다. JPG·PNG·WEBP, 5MB 이하만 받고, 파일 앞부분(매직 바이트)으로 실제 이미지 형식인지도 확인합니다.
2. **호출 제한**: IP당 시간당 10건, 하루 전체 200건입니다. (서버 재시작 시 초기화되는 메모리 방식)
3. **추출**: 서버가 Gemini를 호출합니다. API 키는 서버에만 있습니다. 응답은 JSON 스키마(`name`, `price_text`, `price_won`, `category`, `uncertain`)로 강제하고, 이미지 속 글자는 지시가 아니라 데이터로만 취급하도록 지시합니다.
4. **장애 대응**: 혼잡(503)이면 같은 모델로 최대 2번 재시도합니다. 30초 안에 응답이 없거나(타임아웃) 한도 초과(429)이면 `GEMINI_FALLBACK_MODEL`로 전환합니다.
5. **가격 재검증** (`menuPrice.js`): 사진에 적힌 표기(`price_text`)를 서버가 직접 정수로 바꿉니다.
   - 변환 예: `3000원`, `4,000원`, `1293won`, `1만원`, `만원`, `1만 2천원`, `삼천원`
   - 서버가 계산한 값과 모델이 준 값이 다르면 `uncertain`
   - 500원 미만, 10만 원 초과는 `rejected`
   - 천 원 단위를 소수로 적은 표기(`3.0`, `15.9`, `15.900`, `40,0`)는 `× 1000`으로 계산합니다. 단위가 없는 소수는 원래 모호하므로 **모델이 같은 값을 냈을 때만 `ok`**이고, 모델 값이 없거나 다르면(범위 밖 포함) 사진 속 표기에서 계산한 값을 쓰되 `uncertain`으로 표시합니다.
   - 쉼표 뒤에 1~2자리만 오는 `40,0`은 천 단위 구분이 아니라 소수점으로 읽습니다. (`40,000`은 그대로 40,000원)
   - 그 밖에 단위 없는 100 미만 숫자(예: `9`)는 서버가 해석하지 못하므로 모델 값만으로 `uncertain` 처리
6. **반환**: 검증을 통과한 `items`와 걸러진 `rejected`를 돌려줍니다.

### 응답 예시

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

- `category`: `meal`(한 끼 식사), `side`(사이드: 공기밥·사리·반찬), `drink`(음료), `alcohol`(주류). "만원 이하" 판정은 `meal`만 기준으로 합니다. 분류가 없거나 이상하면 `uncertain`입니다.
  - **고기와 함께 시키는 찌개·국·냉면·소면·라면·밥류**(고깃집의 된장찌개, 된장소면, 공기밥 등)는 식사가 아니라 `side`입니다. 같은 가게라도 점심특선·정식·덮밥·국밥처럼 그 자체로 한 끼가 되는 메뉴는 `meal`입니다. 분류는 AI가 프롬프트(`menuOcr.js`)의 설명을 보고 판단하며, 서버에는 가격이나 키워드 규칙이 따로 없습니다.
  - **술집이 아닌 식당에서 안주로 파는 단품 요리**(감자전, 계란말이, 제육볶음, 닭볶음탕 등)는 식사(`meal`)로 봅니다. 술집은 지도 가맹점 목록에서 미리 걸러지므로 술집 안주 기준은 따로 두지 않습니다.
  - 100g당 가격의 정육 가격표처럼 고기 자체의 분류는 별도 규칙 없이 모델의 판단에 맡기므로 결과가 일정하지 않을 수 있습니다.
- `status`: `ok` 또는 `uncertain`. 공개 여부가 아니라 **관리자 검수 우선순위**입니다. 모든 제보는 관리자 승인을 거칩니다.

## POST /api/merchants/:merchantId/menu-submissions

가게를 지정해 메뉴판 사진을 **제보**합니다. 위의 OCR 결과를 `menu_submissions`에 **검수 대기(`pending`)로 저장**하고, 원본 사진을 비공개 폴더에 보관합니다. 관리자가 승인하기 전에는 지도에 반영되지 않습니다.

```powershell
curl.exe -F "image=@menu.jpg" http://localhost:3001/api/merchants/2441/menu-submissions
```

- 요청: `:merchantId`는 지도가 쓰는 **`merchant_crawl_staging.merchant_id`**(예: `2441`)이고, 본문은 `multipart/form-data`의 `image` 필드(JPG·PNG·WEBP, 5MB 이하)
- 성공(201): `submission_id`, `status: "pending"`, `has_uncertain`, `items`, `rejected`, `model`
- 실패: 사진 없음·형식 오류·잘못된 가맹점 번호 `400`, 없는 가맹점 `404`, 메뉴를 읽지 못함 `422`(저장하지 않음), 호출 제한 초과 `429`
- 없는 가맹점은 AI를 호출하기 **전에** 거절하므로 비용이 들지 않습니다.
- 가게 번호가 있는지는 `merchant_crawl_staging`에서 확인하고, 이때 가게 이름·주소도 함께 찾아 제보와 같이 저장합니다. staging 표가 없는 옛 로컬 DB에서만 `.env`에 `MERCHANT_SOURCE_TABLE=merchants`를 적어 씁니다. (`merchants`와 `merchant_crawl_staging`만 허용합니다.)
- 사진은 `backend/uploads/menu-photos/`에 서버가 정한 이름으로 저장됩니다(Git에 올라가지 않음). 관리자가 승인·반려하면 삭제합니다. 폴더는 `MENU_PHOTO_DIR`로 바꿀 수 있습니다.
- DB 저장이 실패하면 방금 저장한 사진도 함께 지웁니다.
- 로그인한 사용자가 올리면 제출자(`submitted_by`, `submitted_email`)가 기록되고, 로그인하지 않아도 제보는 받습니다. (`auth.js`의 `attachUser`)
- **배포 주의**: Render 같은 서버는 재시작 때 파일이 사라지므로, 배포 전에 사진 저장소를 Supabase Storage 등으로 바꿔야 합니다. (`menuSubmissions.js`의 `savePhoto`, `deletePhoto`만 바꾸면 됩니다.)

## 관리자 검수 (`menuAdmin.js`, `adminRoutes.js`)

관리자(`ADMIN_EMAILS`)만 쓸 수 있습니다. 화면은 프론트의 `/admin.html`입니다. (프론트 쪽 설명은 [frontend/README.md](../frontend/README.md))

| 주소 | 하는 일 |
| --- | --- |
| `GET /api/admin/submissions?status=pending\|approved\|rejected` | 제보 목록(대기는 오래된 순) |
| `GET /api/admin/submissions/:id` | 제보 상세(OCR 결과 전체) |
| `GET /api/admin/submissions/:id/photo` | 원본 사진(관리자만, 브라우저에 저장되지 않음) |
| `POST /api/admin/submissions/:id/approve` | 승인. 본문 `{ items: [{name, price_won, category}], note? }` |
| `POST /api/admin/submissions/:id/reject` | 반려. 본문 `{ note? }` |

- 승인하면 **한 트랜잭션 안에서** 그 가게의 기존 메뉴를 모두 지우고 승인한 목록으로 교체합니다. 중간에 실패하면 아무것도 바뀌지 않습니다.
- 서버가 보낸 목록을 다시 검사합니다(이름 100자 이하, 가격 500~100,000원 정수, 분류 meal/side/drink/alcohol, 최대 300개). `items`를 안 보내면 AI가 확신한 항목(`ok`)만 저장합니다.
- 만원을 넘는 메뉴나 사이드·음료·주류도 모두 `menus`에 저장됩니다. 만원은 저장할 때 거르는 기준이 아니라 조회할 때 계산하는 기준입니다. 관리자가 뺀 메뉴와 AI가 걸러 낸 메뉴는 저장되지 않지만, AI가 읽은 원본(`menu_submissions.items`, `rejected`)은 승인 후에도 남습니다.
- 이미 처리된 제보를 다시 승인·반려하면 `409`입니다. 반려는 기존 승인 메뉴를 건드리지 않습니다.
- 승인·반려가 끝나면 보관 중이던 원본 사진을 지웁니다.

## 로그인·관리자 확인 (`auth.js`)

서버가 프론트의 로그인 토큰(`Authorization: Bearer …`)을 **Supabase에 직접 물어서** 확인합니다. 별도 비밀 키는 필요 없습니다.

- 확인이 끝나면 `req.user = { id, email, name, isAdmin }`가 채워집니다. `requireAuth`(비로그인 401), `requireAdmin`(관리자가 아니면 403), `attachUser`(로그인했을 때만 채우고 막지 않음)를 쓸 수 있습니다.
- **기본은 잠금**입니다. 설정이 없으면 503, `ADMIN_EMAILS`가 비어 있으면 아무도 관리자가 아닙니다. 이메일 인증이 끝난 계정만 관리자로 인정합니다.
- 설정 확인용: `GET /api/me`(로그인 필요), `GET /api/admin/ping`(관리자만).
- "로그인 확인 서버에 연결하지 못했습니다"가 뜨면 `SUPABASE_URL` 형식(`https://…supabase.co`)부터 확인하세요.

## DB 테이블 (`migrations/`)

| 테이블·뷰 | 역할 |
|---|---|
| `menu_submissions` | 제보 한 건(사진 한 장)의 OCR 결과와 승인 상태(`pending`/`approved`/`rejected`). 제출 당시의 가게 이름·주소(`merchant_name`, `merchant_address`)도 함께 저장합니다. |
| `menus` | 관리자가 승인한 확정 메뉴. 지도와 필터는 이 테이블만 봅니다. |
| `merchant_menu_summary` | 가게(`merchant_id`)당 한 줄. 식사 최저가와 **`in_under_10000`**(`Y`: 식사 중 1만 원 이하가 있음 / `N`: 식사는 있는데 모두 1만 원 초과 / 비어 있음: 아직 모름. 1만 원은 포함) |

- 파일: `001_menu_tables.sql`(테이블), `002_menu_summary_and_snapshot.sql`(판정 뷰, 이름·주소 저장 열, RLS)
- 적용: `cd backend; node migrate.js` (적용한 파일은 건너뛰며, `.env`의 `DB_*`가 가리키는 DB에 적용됩니다.)
- 메뉴 제보·확정 메뉴·리뷰의 `merchant_id`는 **`merchant_crawl_staging`**을 가리켜야 합니다. 아직 옛 `merchants`를 가리키는 DB에서는 `migrations/later/003_switch_to_crawl_staging.sql`을 Supabase SQL Editor에서 직접 실행합니다. (이 폴더는 `migrate.js`가 읽지 않아 실수로 적용되지 않습니다.)
  - 옛 번호(`CC-000001`)를 새 번호로 바꾸는 기준: 이름이 같고 도로명+건물번호가 같은 가게가 정확히 한 곳이면 그 번호로, 못 찾으면 이름과 시군구가 같은 가게가 정확히 한 곳일 때만 바꿉니다. 모호하거나 못 찾는 번호가 하나라도 있으면 어떤 번호인지 알리고 **전체를 되돌립니다.**
  - 제보·메뉴·리뷰 3개 표의 연결을 `staging`으로 옮기고, 리뷰 집계 뷰(`merchant_review_summary`)를 `staging` 기준으로 다시 만듭니다. `merchants`, `merchant_naver_info`는 지우지 않습니다. 여러 번 실행해도 안전합니다.
  - **서버(Render) 배포와 같이 해야 합니다.** DB만 바꾸면 리뷰·만원 이하 필터·사진 제보가 잠시 동작하지 않습니다. 리뷰는 다른 팀원 담당이라 미리 알려야 합니다.
  - 적용 뒤에는 `staging` 행을 지우거나 `merchant_id`를 바꾸면 안 됩니다. 크롤링으로 다시 채울 때는 행을 갱신(UPDATE/UPSERT)하세요. 연결 때문에 지우기가 막히고, 지우면 그 가게의 확정 메뉴도 함께 지워집니다.

## 남은 작업

- 사진 저장소를 Supabase Storage로 교체(배포용)
- 마이그레이션 003을 공용 DB에 적용(서버 배포와 같이)
