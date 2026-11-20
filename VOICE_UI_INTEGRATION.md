# 잇다 UI · 음성 길 안내 통합 인계

기준: GitHub main `96eb3509471bd2cb8a6d138649cc48697f569b0c` (PR #21 음식 종류 필터 포함).
브랜치: `feat/voice-navigation-ui-integration-20261120`.
원본 개발 폴더는 보존하고 별도 작업 공간에서 최신 main에 변경을 적용했다. 공유 main은 변경하지 않는다.

## 병합 방식과 유지 기능

main의 App.tsx를 기준으로 상태·API 연결을 유지하면서 로컬 개발본의 지도 중심 UI와 음성 안내만 통합했다. 새 main의 PR #21을 다시 가져왔으며 충돌한 App.tsx에는 양쪽 기능을 직접 연결했다.

| main 기능 | 통합 결과 |
|---|---|
| Google 로그인·로그아웃 | 기존 AuthProvider·Supabase 연결 재사용 |
| 리뷰·평가 항목·별점/거리 정렬 | 집계 API, ReviewPanel, 리뷰 10개 기준 필터 유지 |
| 메뉴판 사진 제보·OCR·관리자 승인 | 기존 모달, 인증, 관리자 화면과 승인 코드를 유지 |
| 만원 이하 식사 필터 | 기존 승인 메뉴 요약 사용, 음성 예산 검색에는 승인 메뉴 이름·가격 추가 |
| 한식·중식·일식·양식·분식 | PR #21 cuisineFilter.ts와 테스트를 수정 없이 사용, UI 버튼·초기화·매칭 근거 연결 |
| 지역별 실제 가맹점과 지도 | 기존 전체 페이지 조회, DB merchant_id, KakaoMap, 클러스터·현재 위치 유지 |
| 가맹 권유 지도 | 기존 mealcard 페이지와 링크 유지 |

전처리 코드·CSV·DB 스키마·마이그레이션은 변경하지 않았다. Gemini 음식 검색 작업과 시연용 가격은 포함하지 않았다.

## 주요 변경 파일

- `backend/server.js`, `walkingRoute.js`: TMAP 호출 공통화, 새 보행 경로 API, 기존 nearest 응답 유지. 가맹점 응답에 기존 승인 메뉴 테이블의 `confirmed_meals`를 추가.
- `backend/guideAi.js`, `guideSpeech.js`: 기존 Groq 클라이언트와 STT 재사용, 의도 해석/근거 답변, Google Chirp 3 HD Aoede 음성.
- `backend/package.json`, `package-lock.json`: Google ADC 인증용 google-auth-library 추가.
- `frontend/src/App.tsx`, `FinderDesign.css`, `VoiceGuide.css`, `public/figma/*.svg`: 기존 기능을 유지한 지도·목록·상세 UI와 항상 접근 가능한 음성 상태.
- `frontend/src/VoiceGuide.tsx`, `recordedHandsFree.ts`, `voiceActivation.ts`, `guideSpeech.ts`: 호출어·STT·AI·음성 응답과 경로 연결. 기존 VoiceSearch 재사용.
- `frontend/src/walkingProgress.ts`, `arrivalAssist.ts`: GPS 경로 진행, 근처 도착 추정, 명시적 동의 이후 DB 번호로 전화 앱 요청.
- `frontend/src/merchantApi.ts`, `merchantData.ts`, `mealPrice.ts`: 기존 필드 보존 및 승인 메뉴 매핑·예산 필터.
- 관련 backend/frontend 테스트 및 `.env.example`, `backend/NAVIGATION.md`.

## 실행 및 환경변수

Node.js 22 이상을 사용한다.

```sh
cd backend
npm ci
# 기존 .env가 없을 때만 .env.example을 복사하고 팀 서버 값을 설정
npm test
node server.js
```

별도 터미널:

```sh
cd frontend
npm ci
# .env.example을 참고해 .env.local 설정
npm run dev
# 배포 산출물 검증
npm run build
```

서버: 기존 `GROQ_API_KEY`, `TMAP_APP_KEY`, DB/Supabase/admin/CORS 설정 유지. 추가 `GUIDE_TEXT_MODEL`, `GUIDE_GOOGLE_TTS_ENABLED=true`, `GOOGLE_TTS_API_KEY` 또는 `GOOGLE_APPLICATION_CREDENTIALS`, 기본 음성 `GUIDE_GOOGLE_TTS_VOICE=ko-KR-Chirp3-HD-Aoede`. 선택: `GUIDE_GOOGLE_TTS_DAILY_CHARS`, `GOOGLE_CLOUD_QUOTA_PROJECT`.

프론트: `VITE_API_BASE_URL`, `VITE_KAKAO_MAP_APP_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GUIDE_GOOGLE_TTS=true`. 서버 비밀 키·.env·서비스 계정 JSON은 Git/프론트 번들에 포함하지 않는다. 인증값 없이 실제 서비스가 동작한다고 가정하지 않는다.

API 계약·시간 제한·오류 처리·TTS 할당량은 [backend/NAVIGATION.md](backend/NAVIGATION.md)에 정리했다.

## 검증 결과 (2026-11-20)

1차: 최신 main 비교, PR #21 기능 유지, 기존 인증/리뷰/메뉴 승인/지도 모듈 보존 확인. 원본에서 참고한 19개 파일 SHA-256이 작업 전과 동일했다. 추가 변경에 API 키, .env, 개인 PC 서버, 생성 DB/CSV가 포함되지 않도록 점검했다.

2차:

- frontend TypeScript/Vite 빌드 성공. 500 kB 초과 번들 경고는 남아 있다.
- backend 테스트 **66/66 통과**. 기존 인증·관리자·메뉴 기능 및 추가 TMAP/AI/TTS 검증 포함.
- frontend 테스트 **65개 중 63개 통과, 2개 실패**. 실패는 기존 `merchants.test.ts`의 옛 세부 업종을 `category`로 전달하는 두 테스트다. 최신 main 파일만 분리해 재실행해도 동일하게 실패했다. 기존 데이터·필터 로직을 임의로 변경해 숨기지 않았다. 새 음식 종류 필터 테스트 및 이번에 추가한 음성/메뉴 매핑 테스트는 통과했다.
- Edge headless에서 합성 가맹점·API·GPS·음성 재생·전화 연결을 사용하는 모의 브라우저 검증을 수행했다. 리뷰 정렬/개수, 승인 가격, PR #21 음식 종류, 메뉴판 제보의 로그인 요구, 자연어 요청→조회 근거 전달, 보행 경로→근처 추정→거절/동의 후 전화 앱 요청, 전화번호 없음 처리를 확인했다. 1366×900 및 390×844 화면에서 확인했고 가로 넘침/실행 오류가 없었다.
- 이번 작업 공간에서는 실제 DB, TMAP/Groq/Google/Kakao 키를 넣어 외부 API를 재조회하지 않았다. 실제 마이크·GPS 보행·스피커 음질·Android/iPhone 전화 발신은 **미검증**이다. 모의 자료는 제품 데이터에 포함하지 않았다.

## 팀원이 합칠 내용

1. 이 기능 브랜치를 최신 main과 비교해 UI 및 음성 연결을 함께 검토한다. 옛 파일 전체를 main에 복사하지 않는다.
2. 서버 의존성과 환경변수를 설정한다. 기존 메뉴 승인 테이블/요약을 사용하며 새로운 마이그레이션은 없다.
3. 팀 DB에서 가맹점 조회, 리뷰·메뉴 제보·관리자 승인, 가격 필터를 실제 확인한다.
4. HTTPS 또는 localhost에서 마이크/소리/위치 권한을 허용한 뒤 실제 음성 흐름을 확인한다. 자동재생·권한 차단 상태에서는 사용자 조작이 필요할 수 있다.
5. Android/iPhone에서 전화 앱 요청 후 OS의 발신 확인을 검증한다. GPS 근접을 입구 도착으로 단정하거나 전화 앱 열기를 통화 완료로 표시하지 않는다.
6. 검토 후 팀이 main 병합을 결정한다. 업로드 당시 이후 main에 새 변경이 생기면 다시 비교한다.
