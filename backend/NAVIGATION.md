# 음성 네비게이션 백엔드 인계

최신 main `e3dfeadce6dcf993545cfb7cd0ff90fbe91cc2e3` 기준. 기존 STT와 가맹점 조회, 메뉴 제보/OCR API를 유지하고 음성 네비게이션 API를 추가한다. 프론트엔드·전처리·CSV·DB 스키마 변경은 없다.

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

## 검증 기록 (2026-11-20)

1차: 변경 파일을 backend로 제한하고, 기존 STT·가맹점 SQL·메뉴 제보/OCR 블록 보존 및 키 제외를 검사했다. TMAP 호출을 공통 모듈로 추출해 기존 거리 비교에서도 재사용한다.

2차: `npm ci --ignore-scripts` 성공. 기존 메뉴 OCR·가격·제보 테스트와 새 AI·경로·TTS 테스트 29개 통과. JavaScript 구문 검사 통과.

실제 키를 메모리로만 전달한 별도 서버에서 기존 STT, 자연어 해석, TMAP 경로, 기존 nearest 응답 형식, Chirp 3 HD Aoede 음성 생성 HTTP 200을 확인했다. 실제 가맹점은 기존 배포 서버에서 읽어 경로를 검증했다. 새 작업 공간의 DB 설정은 없어서 로컬 `/api/merchants`는 500이며, 로컬 DB 연결 검증은 미완료이다.

AI 답변은 실조회 중 한 번 502가 발생했고, 별도 재조회에서는 200을 확인했다. 실패가 항상 없는 것으로 보장하지 않는다. STT 검증은 합성 음성 파일 업로드이며 실제 마이크·GPS 보행·Android/iPhone 통화·스피커 청취는 이번에 검증하지 않았다.

## 팀 통합 순서

1. 기능 브랜치의 백엔드 변경을 PR로 검토한다. 기존 backend 전체를 예전 폴더로 덮어쓰지 않는다.
2. 서버 환경변수와 의존성을 설정하고 기존 메뉴·DB 기능도 팀 환경에서 확인한다.
3. 팀이 백엔드를 main에 병합한 뒤, 최신 main에서 프론트 연결용 별도 브랜치를 만든다.
4. 화면 디자인/CSS는 유지하고 자동 호출·마이크 상태·음성 재생·GPS 진행 판단·도착 추정·전화 동의만 연결한다. 기존 로컬 프론트 전체를 덮어쓰지 않는다.
5. 브라우저가 이 서버의 네 API를 호출하도록 배포 프록시/주소를 설정한다. 로컬 시연용 33123 서버는 이번 커밋에 포함하지 않는다.
6. 마이크·오디오 권한 및 모바일 OS 전화 확인을 실제 기기에서 검증한다. 전화 앱 요청을 실제 통화 완료로 표시하지 않는다.

현재 2단계 프론트 통합은 백엔드 main 반영 전이므로 수행하지 않는다.
