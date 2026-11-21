# 잇다(EATDA) 프론트엔드

React·TypeScript·Vite로 구현한 춘천시 아동급식카드 가맹점 찾기와 가맹 권유 지도입니다.

프로젝트 소개, 전체 기능, 백엔드 실행, 데이터 갱신 및 배포 방법은 [프로젝트 README](../README.md)를 참고하세요.

## 실행

이 폴더에 `.env.local`을 만듭니다.

```env
VITE_KAKAO_MAP_APP_KEY=카카오_JavaScript_키
VITE_API_BASE_URL=http://localhost:3001
VITE_SUPABASE_URL=https://프로젝트ref.supabase.co
VITE_SUPABASE_ANON_KEY=본인_Supabase_anon_키
```

`VITE_SUPABASE_*`는 구글 로그인에 필요합니다(없으면 화면이 뜨지 않습니다). anon(공개) 키만 쓰고 `service_role` 키는 넣지 않습니다. 백엔드 `.env`의 `SUPABASE_URL`, `SUPABASE_ANON_KEY`와 같은 값입니다. 로그인 없이 메뉴판 사진 올리기를 시험할 때만 `VITE_UPLOAD_REQUIRES_LOGIN=false`를 추가합니다(기본은 로그인 필요).

```powershell
npm install
npm run dev -- --port 5173 --strictPort
```

카카오 앱의 JavaScript SDK 허용 도메인에 `http://localhost:5173`을 등록합니다. 포트가 다르면 지도가 뜨지 않으므로 `--strictPort`로 5173을 고정합니다.

- 첫 화면(잇다 홈): `http://localhost:5173/` — 가맹점 지도와 가맹 권유 지도로 가는 카드 두 장, 구글 로그인
- 가맹점 지도: `http://localhost:5173/finder.html`
- 가맹 권유 지도: `http://localhost:5173/mealcard.html`
- 관리자 검수: `http://localhost:5173/admin.html`
- 음성 인식·도보 거리 조회·메뉴판 제보·관리자 검수에는 백엔드도 실행해야 합니다.

## 메뉴판 사진 제보와 "만원 이하 식사" 필터

- **사진 올리기**: 지도에서 가게를 고르면 팝업에 "메뉴판 사진 올리기" 버튼이 나옵니다. 메뉴판이 여러 장이면 **한 번에 최대 5장**까지 골라 올릴 수 있고(장마다 번호 표시, × 로 빼기), 결과에는 메뉴마다 몇 번째 사진에서 읽었는지 표시됩니다(`MenuUploadModal.tsx`). 사진 검사와 서버 전송은 `menuSubmission.ts`가 맡고, 결과는 관리자 검수를 거친 뒤 지도에 반영됩니다.
- **만원 이하 식사 필터**: 목록 위 "만원 이하 식사" 체크박스를 켜면 관리자가 승인한 메뉴판에서 만원 이하 식사가 확인된(`Y`) 가게만 지도와 목록에 남습니다. `N`이거나 아직 승인된 메뉴가 없는 가게는 빠집니다. `Y`인 가게는 카드에 초록색 "만원 이하 · 7,000원~" 표시가, 팝업에 "만원 이하 식사 있음"이 붙습니다. "필터 초기화"를 누르면 함께 해제됩니다.
  판정 값(`in_under_10000`, `min_meal_price_won`)은 백엔드 `GET /api/merchants`가 내려주며(`merchantApi.ts`), 필터 계산은 `merchants.ts`의 `filterMerchants`입니다.

## 가맹점 지도: 목록 접기/펼치기

데스크톱에서는 지도가 화면 전체에 깔리고 왼쪽 목록이 그 위에 떠 있습니다. 목록 오른쪽 가장자리의 **‹ 손잡이**를 누르면 목록이 왼쪽으로 접히고(손잡이는 `›`로 바뀝니다), 다시 누르면 펼쳐집니다.

- 지도 크기는 바뀌지 않으므로 마커가 다시 그려지지 않습니다. (`prefers-reduced-motion` 설정이면 애니메이션 없이 바로 바뀝니다.)
- 마지막 상태는 브라우저에 기억합니다. (`src/finderSidebar.ts`, 저장소를 못 쓰는 환경에서는 항상 펼친 상태)
- 접힌 채로 **검색**하거나 지도에서 **마커 묶음**을 누르면 결과가 목록에 나오므로 자동으로 펼칩니다. 이때 저장된 선택(접힘)은 바꾸지 않습니다.
- 접힌 목록은 키보드 탭 순서에서도 빠지고, 손잡이는 열림 상태(`aria-expanded`)와 "가맹점 목록 접기/펼치기" 이름을 알립니다.
- 모바일(폭 760px 이하)은 목록과 지도를 번갈아 보여 주는 별도 방식이라 이 손잡이는 없고, 아래의 모바일 전용 접기 방식을 씁니다.

### 모바일: 지도만 보기

하단 "지도" 탭에서 검색 카드와 음성 안내 카드를 접어 지도만 볼 수 있습니다.

- **검색 카드**: 카드 맨 아래의 "▲ 지도만 보기"를 누르면 카드가 위로 미끄러져 나가고, 지도 위쪽 가운데에 "검색·필터 ▾" 알약이 남습니다. 알약을 누르면 다시 펼쳐집니다. 목록이 곧 내용인 "찾기" 탭에서는 접지 않습니다. (카드가 지도 위에 떠 있어 접어도 지도 크기는 바뀌지 않습니다.)
- **음성 안내 카드**("마이크가 준비됐어요"): 카드 오른쪽 위의 "접기 ▾"를 누르면 사라지고 지도가 그만큼 넓어지며, 지도 오른쪽 아래에 "음성 안내" 알약이 남습니다. 이 카드는 데스크톱에서도 같은 방식으로 접을 수 있습니다.
- 접어 둔 음성 카드는 **새 답변이나 오류가 오면 자동으로 펼칩니다**(저장된 선택은 바꾸지 않음). 답변이 카드에 표시되므로 놓치지 않게 하기 위해서입니다. (`revealVoiceCard`, `src/finderSidebar.ts`)
- 두 카드의 접힘 상태는 각각 브라우저에 기억합니다.

## 검색 (가게 이름·메뉴·주소)

검색창은 가게 이름, 주소, 업종에 더해 **관리자가 승인한 메뉴 이름**으로도 가게를 찾습니다(`src/menuSearch.ts`).

- 띄어쓰기를 무시합니다. "김밥 천국"으로 "김밥천국"을, "연어덮밥"으로 "연어 덮밥" 메뉴를 찾습니다.
- 여러 단어면 모든 단어가 들어 있는 가게만 남깁니다. 단어는 이름·메뉴·주소 중 어디에 있어도 됩니다(예: "퇴계 라면").
- 메뉴로 걸린 가게는 카드에 "메뉴: 라면 외 1개"처럼 표시됩니다.
- 메뉴는 승인된 메뉴판이 있는 가게만 찾아집니다. 메뉴판이 없는 가게는 이름·주소·업종으로만 찾아집니다.

## 관리자 검수 화면 (`/admin.html`)

관리자만 쓸 수 있는 별도 페이지입니다(`src/admin/`). 구글로 로그인하면 대기 중인 제보가 오래된 순으로 나옵니다.

1. 왼쪽에서 제보를 고르면 원본 사진과 AI가 읽은 메뉴 목록이 나옵니다. 사진이 여러 장이면 작은 사진으로 골라 보고, 메뉴 줄의 "사진 n"을 누르면 그 사진으로 바뀝니다. 노란색 "확인 필요" 줄은 AI가 확신하지 못한 항목입니다.
2. 이름·가격·분류(식사/사이드/음료/주류)를 고치거나, 메뉴를 삭제·추가할 수 있습니다. 만원 이하 식사 여부를 미리 보여 줍니다.
3. 화면에 **지금 이 가게에 등록된 메뉴**가 함께 나오고, 승인 방식을 고릅니다.
   - **기존 메뉴에 추가**(기본): 이름이 같은 메뉴는 새 가격·분류로 바뀌고, 나머지 기존 메뉴는 그대로 남습니다. 메뉴판이 여러 장인 가게에 씁니다.
   - **통째로 교체**: 기존 메뉴를 모두 지우고 화면의 목록만 남깁니다. 메뉴판이 새로 바뀌었을 때 씁니다.
   - 승인 전에 "새 메뉴 N개 추가, M개 갱신, K개 유지 → 총 X개"와 만원 이하 여부를 미리 보여 주고, 확인 창이 한 번 뜹니다. **반려**하면 제보만 닫히고 기존 메뉴는 그대로입니다.
4. "승인됨", "반려됨" 탭에서 처리한 제보를 볼 수 있습니다(읽기 전용).

관리자가 아닌 계정으로 들어가면 "관리자가 아니에요"와 함께 **로그인한 이메일**이 보입니다. 그 이메일을 백엔드 `.env`의 `ADMIN_EMAILS=`에 적고 백엔드를 껐다 켜면 됩니다. 로그인 후에는 메인 페이지로 돌아오므로 `/admin.html`로 다시 들어가세요. 서버 규칙은 [backend/README.md](../backend/README.md)를 참고하세요.

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
| `index.html`, `src/home/` | 첫 화면(잇다 홈): 헤더, 로그인, 지도·가맹 권유 지도 카드. 카드 목록은 `src/home/links.ts` |
| `finder.html`, `src/App.tsx` | 가맹점 지도 화면(검색·필터·목록·상세) |
| `src/KakaoMap.tsx` | 지도·업종별 마커·군집 |
| `src/kakao.ts` | 카카오 SDK 로딩·타입 정의 |
| `src/merchants.ts`, `src/merchantData.ts` | 가맹점 모델·검색 |
| `src/finderSidebar.ts` | 가맹점 지도의 목록 접힘 상태 저장·복원 |
| `src/merchantApi.ts` | 백엔드 `/api/merchants`(메인 테이블 `merchant_crawl_staging`) 응답을 화면 모델로 변환. 영업시간은 평일·토요일·공휴일 |
| `src/VoiceSearch.tsx`, `src/voiceIntent.ts` | 녹음·음성 검색어 처리 |
| `src/NearestVoice.tsx` | 현재 위치 기반 도보 거리·음성 안내 |
| `src/apiUrl.ts` | 환경 변수 기반 API 주소 |
| `src/AuthProvider.tsx`, `src/supabaseClient.ts` | Supabase 구글 로그인 |
| `src/MenuUploadModal.tsx`, `src/menuSubmission.ts` | 메뉴판 사진 올리기 창, 사진 검사·서버 전송 |
| `src/admin/`, `admin.html` | 관리자 검수 화면 |
| `src/adminApi.ts`, `src/adminItems.ts` | 관리자 API 호출, 메뉴 수정·검사·미리보기 계산 |
| `src/data/merchants.generated.ts` | CSV에서 생성된 가맹점 데이터 |
| `src/mealcard/` | 학교·미가맹 식당·가맹 권유 지도 |
| `public/mealcard/map-data.json` | 가맹 권유 분석 데이터 |

가맹점 데이터는 프로젝트 최상위에서 `python scripts/generate_merchants.py`로 갱신합니다. 카카오 REST API 키는 좌표 보완 스크립트를 실행할 때만 필요합니다.
