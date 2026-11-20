# 음성 길 안내와 가맹점 UI 통합

최신 main의 PR #21 (`96eb350`)을 기준으로 기존 기능과 새 UI·음성 길 안내를 결합한 브랜치: `feat/voice-navigation-ui-integration-20261120`. 공유 main에 직접 푸시하거나 병합하지 않는다. 전처리·CSV·DB 스키마는 변경하지 않는다.

## 실행

Node.js 22 이상에서 저장소의 backend 폴더로 이동한다.

```sh
npm ci
# .env가 없을 때만 .env.example을 복사하고 서버용 값을 설정한다.
npm test
node server.js
```

현재 프로젝트는 Express JavaScript 서버이므로 별도 빌드 명령이 없다. `node --check server.js`와 `npm test`로 확인한다. 기존 서버는 GROQ_API_KEY가 없으면 시작하지 않는다. 가맹점 조회에는 기존 DB 접속 설정이 별도로 필요하다.

## 환경변수

실제 값은 서버의 .env 또는 배포 환경 설정에만 저장한다. .env, 서비스 계정 JSON, API 키는 커밋하지 않는다.

| 이름 | 용도 |
|---|---|
| GROQ_API_KEY | 기존 STT 및 자연어 해석·답변 |
| GUIDE_TEXT_MODEL | 계정에서 사용 가능한 Groq 텍스트 모델. 누락하면 새 AI API는 503 |
| TMAP_APP_KEY | 기존 거리 비교와 새 보행 경로 조회 |
| GUIDE_GOOGLE_TTS_ENABLED | `true`로 설정해야 음성 생성 활성화 |
| GOOGLE_TTS_API_KEY | Google Cloud Text-to-Speech API 키 |
| GUIDE_GOOGLE_TTS_VOICE | 기본 `ko-KR-Chirp3-HD-Aoede`. 같은 목소리를 유지하려면 이 값 사용 |
| GUIDE_GOOGLE_TTS_DAILY_CHARS | 프로세스별 일일 문자 제한. 기본 15000, 최대 100000 |
| GOOGLE_APPLICATION_CREDENTIALS | API 키 대신 ADC 사용 시 서버에 보관한 자격 파일 경로 |
| GOOGLE_CLOUD_QUOTA_PROJECT | ADC 사용 시 필요할 수 있는 할당 프로젝트 |
| PORT / FRONTEND_URL | 기존 서버 포트 및 허용 프론트엔드 주소 |
| DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME / DB_SSL | 기존 DB 설정. 본 변경에 DB 마이그레이션 없음 |

TTS 제한·캐시는 서버 메모리에만 유지되므로 재시작 시 초기화되고 여러 인스턴스 간 공유되지 않는다. 음성 생성 실패 시 다른 목소리로 대체하지 않고 오류를 반환한다.

## API 계약

기존 `/api/stt`의 multipart `audio` 입력 및 `{text}` 응답은 유지한다. `/api/walking-nearest`의 `{nearest:{id,name,address,meters},total,compared,attempted}` 형식도 유지한다.

### POST /api/walking-route

```json
{
  "lat": 37.88,
  "lng": 127.73,
  "store": {
    "id": 1,
    "name": "가맹점명",
    "address": "가맹점 주소",
    "coordinates": { "lat": 37.874, "lng": 127.718 }
  }
}
```

응답: `{meters, segments:[{path:[{lat,lng}],meters}], steps:[{point:{lat,lng},instruction}]}`.
좌표·가맹점명 검증 실패 400, TMAP 키 누락 503, 타임아웃·경로 실패·잘못된 공급자 응답 502. TMAP 요청 제한 시간은 12초이다. 경로 좌표는 호출자가 전달한 것이며 서버가 가맹점 DB와 대조하는 API는 아니다. 총거리나 GPS만으로 입구 도착·보행 안전을 보장하지 않는다.

### POST /api/guide-speech

입력 `{text:"안내 문장"}`. 최대 400자. 응답 `audio/mpeg`.
잘못된 입력 400, 비활성화 503, 문자/동시 요청 한도 429, Google 실패 502. Google 요청 제한 시간 8초, 동일 문장 캐시 64개, 동시 생성 최대 4개.

### POST /api/guide-intent

입력 `{text, hasDestination?, hasProposal?, previousSearch?, facts?}`.
응답 action은 `search | closer | remaining | sign | yes | no | reply`.
search에는 `query:{terms,category,budget}`가 포함되고 reply에는 `reply` 문자열이 포함된다.
`sign`은 기존 클라이언트의 도착 확인 의도와 호환하기 위한 값이다. 간판 OCR 엔드포인트는 추가하지 않는다.

### POST /api/guide-answer

입력 `{text, facts:[{name,address,category,meals:[{name,price,preview}]}], selectedName?}`.
응답 `{reply}`. facts는 클라이언트가 전달한 조회 자료로서 이 API에서 DB 원본과 대조하지 않는다. 제공되지 않은 메뉴·가격·영업·안전 정보를 추측하지 않도록 지시한다.

AI API는 키/모델 누락 503, 잘못된 입력 400, 공급자 오류·응답 형식 오류 502. 모델 요청 제한 시간 10초, 자동 재시도 없음. 호출어 처리·가게 선택·사용자 동의 판정은 프론트에서 명시적으로 처리해야 한다.

## 프론트엔드 연결

frontend에서 `npm ci`, `npm run build`, 개발 시 `npm run dev`를 사용한다.
기존 `.env.local`의 `VITE_API_BASE_URL`, `VITE_KAKAO_MAP_APP_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 팀 환경에 맞춘다. `VITE_GUIDE_GOOGLE_TTS=true`가 기본이며 서버 비밀 키는 프론트에 넣지 않는다.

- 기존 로그인/로그아웃, 리뷰/태그 집계·정렬, 리뷰 개수 필터, 메뉴판 제보 및 관리자 승인, 만원 이하 식사 필터, 지역 선택, 가맹 권유 지도는 유지한다.
- PR #21의 음식 종류 분류 모듈·테스트·규칙은 변경하지 않고 새 UI에서 동일하게 사용한다. 유형/음식 종류/검색어/가격 필터는 전체 지역 데이터를 대상으로 적용한다.
- 기존 GET `/api/merchants` 응답에 `confirmed_meals:[{name,price}]`만 추가한다. 기존 `public.menus`에서 관리자가 승인한 `category='meal'` 행을 읽는다. 테이블 생성·변경은 없다. 기존 `merchantId`, 리뷰 및 가격 요약 필드도 보존한다.
- 음성 입력은 기존 `/api/stt`를 호출한다. 새 `/api/guide-intent`로 의도를 해석하고 실제 조회된 가맹점/승인 메뉴를 검색한다. `/api/guide-answer`에는 조회한 사실을 전달하며 `/api/guide-speech`에서 같은 Chirp 음성을 생성한다. AI 실패 시 기본 검색임을 안내한다.
- 선택한 가맹점을 `/api/walking-route`로 조회하고 GPS 진행에 따라 경로 안내를 읽는다. 근처 도착은 추정이며 입구 확인으로 단정하지 않는다.
- 전화 도움 질문 이후 명시적인 동의가 있으면 DB 전화번호로 `tel:` 연결을 요청한다. 번호가 없으면 안내한다. OS의 발신 확인을 우회하지 않고 실제 통화 완료로 표시하지 않는다.
- 마이크 상태/인식/답변은 닫힌 상담창 밖에서도 접근할 수 있다. 브라우저가 권한을 허용한 경우 호출어를 대기하며, 권한·자동재생이 차단되면 상태와 재시도 조작을 제공한다. HTTPS 또는 localhost가 필요하다. 백그라운드/잠금 화면 지속 수신과 모바일 무확인 자동발신을 보장하지 않는다.
- 이번 작업에 간판 OCR, Gemini 음식 검색, 개인 PC 전용 음성 서버, 시연용 가격은 포함하지 않는다. main에 이미 있는 메뉴판 OCR은 그대로 유지한다.

## 검증 및 팀 반영

구체적인 검증 결과와 변경 범위는 저장소 루트의 `VOICE_UI_INTEGRATION.md`를 참고한다. 이 브랜치 전체를 팀이 검토한 뒤 병합한다. 예전 개발 폴더의 server.js 또는 App.tsx로 main을 덮어쓰지 않는다. 원본 개발 폴더는 보존했다.

팀 환경에서 서버 키/DB/Supabase/Kakao 도메인을 설정한 후 실제 마이크, 스피커, GPS 이동, Android와 iPhone의 전화 앱 확인을 별도로 수행해야 한다. 모의 브라우저 테스트는 실제 기기 검증을 대체하지 않는다.
