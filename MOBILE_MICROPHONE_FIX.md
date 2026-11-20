# Android 인터넷 음성·GPS·경로·전화 연결 보완

기준 main: `2067561` (PR #27 첫 화면과 finder.html 분리 포함).
브랜치: `fix/android-microphone-resume-20261121`.

## 수정 내용

- 음성 답변·AI 처리 동안 MediaRecorder만 중지하고, 허용받은 마이크 스트림과 AudioContext는 유지한다. 답변 후 같은 입력 연결에서 녹음을 재개한다. 모드 종료·페이지 숨김·통화 앱 연결·컴포넌트 해제 때는 입력 트랙과 컨텍스트를 닫는다.
- 권한 요청 전에 AudioContext 생성/재개를 시도하고, 첫 사용자 조작에서도 같은 컨텍스트를 재개한다. 소리 재생이 차단돼도 마이크 시작을 함께 막지 않는다.
- 브라우저가 실제 지원하는 WebM/Opus, MP4, Ogg 중 녹음 형식을 선택한다. 실제 MIME과 일치하는 파일 이름으로 기존 STT API에 전송한다. Web Audio를 사용할 수 없으면 기존처럼 최대 6초 단위 녹음을 사용한다.
- 구형 Android 인터넷의 AbortSignal.any/timeout 미지원에 대비한 취소·제한시간 처리를 추가한다. 기존 제한시간과 요청 취소를 제거하지 않는다.
- 권한 차단, 다른 앱·통화의 마이크 점유, 마이크 없음, 녹음 형식 오류, HTTPS 필요를 구분해 기존 음성 상태 영역에 표시한다. 입력 트랙이 음소거되면 녹음을 쉬고 해제 후 재개한다.
- 중단 전 STT 결과가 늦게 도착해 새 요청으로 실행되지 않도록 녹음별 세대 번호를 확인한다.
- 수동 녹음에도 형식 선택·빈 녹음 안내·오류 시 트랙 정리·전송 취소/제한시간 처리를 적용한다.
- 길 안내 GPS는 고정밀·캐시 없이 요청하고, 잘못된 좌표/위치 오차/20초 넘게 오래된 위치를 걸러낸다. HTTPS·권한 거절·위치 미수신·시간 초과를 구분한다. 위치 오차가 크거나 경로를 벗어나면 방향 안내를 멈추는 기존 처리를 유지한다.
- 페이지가 숨겨지면 GPS 추적을 정리하고 돌아오면 새 위치를 받는다. 전화 앱을 요청한 동안에는 마이크를 해제한다. 앱에서 돌아오거나 외부 전화 창에서 포커스가 돌아오면 별도 버튼 없이 음성 수신·GPS 추적을 재개한다. 실제 통화 여부를 확인했다는 표현은 하지 않는다.
- 검색·가게 선택·안내 시작·도착 근처 전화 제안·음성 동의 처리는 기존 채팅/버튼과 동일한 기능을 음성으로 실행한다. 전화 제안 뒤 “응”이라고 하면 검증된 DB 번호의 `tel:` 링크를 자동 요청한다. 번호가 없으면 안내하며 임의 번호를 만들지 않는다. OS의 발신 확인 절차를 우회하지 않는다.

기존 자동 호출어, AI 대화, Chirp 3 HD Aoede, GPS·TMAP·전화 도움, DB 검색·가격·메뉴판·홈 화면·UI/CSS는 유지한다. 백엔드와 환경변수는 변경하지 않는다. 원본 개발 폴더와 비밀 설정 파일은 수정하지 않는다.

## 검증 결과

- 최신 main 기준 TypeScript/Vite 빌드 성공.
- frontend 전체 109개 중 107개 통과. 기존 merchants.test.ts의 업종 분류 테스트 2건 실패는 이전 main부터 동일하며 이번 작업에서 변경하지 않았다.
- 마이크·GPS·도착/전화·TTS 관련 frontend 테스트 19/19 통과. backend AI·TMAP·TTS 관련 테스트 12/12 통과.
- 추가 모의 테스트에서 마이크/컨텍스트 재사용, 중첩된 TTS·AI 일시 정지, MP4 전송, Web Audio 부재, 기기 음소거·해제, 권한 거절·마이크 점유 오류, 구형 AbortSignal 호환을 확인했다.
- Edge의 모바일 화면·Android/Samsung Internet 식별 문자열과 모의 MediaRecorder/AudioContext/STT/AI/TTS/GPS를 사용한 브라우저 테스트 통과. 초기 소리 허용 이후 화면 버튼 없이 만원 이하 검색 → AI 답변 → 이따야 여기로 길 안내해줘 → 경로 조회 → GPS 회전 안내 → 근처 도착/입구 미확인 → 전화 제안 → “응” → DB 번호 `tel:` 요청 → 전화 화면에서 복귀 → 자동 음성 수신/GPS 재개 → 남은 거리 질문까지 실행됐다. 동의 전에 전화 요청은 없었고 복귀 후 중복 발신도 없었다. GPS 오차/오래된 좌표에서 안내가 중지됐으며 답변 전후 마이크 권한 요청·AudioContext 생성 횟수는 증가하지 않았다. 실행 오류 0건.
- 운영 서버 `https://eatda.onrender.com`에서 실제 가맹점 조회·guide-intent·guide-answer·Chirp TTS·STT·TMAP 경로 조회 HTTP 200 확인. 실제 가맹점 좌표로 조회한 경로는 167m/6개 구간/2개 안내 지점이었다. STT는 테스트 TTS 음성의 “이따야 근처 식당 찾아줘”를 인식했다. 실제 마이크·GPS 하드웨어·전화 발신 검증을 대체하지 않는다.
- 실제 Android/Samsung Internet 또는 iPhone에서 직접 녹음한 검증은 아직 아니다. 엔진·OS 권한·마이크 하드웨어·실외 소음은 실제 기기에서 확인해야 한다.

## 배포와 휴대폰 확인

프론트엔드 변경이므로 병합 후 프론트를 재빌드/재배포한다. 새 환경변수나 백엔드 재배포는 필요하지 않다. 현재 main에서 가맹점 지도 주소는 `/finder.html`이다.

1. 휴대폰에서 HTTPS 배포 주소의 finder.html을 연다.
2. 휴대폰 설정의 인터넷 앱 마이크 권한과 해당 사이트의 마이크 권한을 모두 허용한다.
3. 최초 OS/사이트 권한 허용 및 브라우저의 첫 소리 허용 절차가 필요할 수 있다. 이 절차 이후 앱 기능은 음성으로 실행한다. 권한·자동재생·발신 확인은 웹사이트가 대신 누를 수 없으며, 필요하면 휴대폰 음성 제어/화면 읽기 기능으로 승인한다.
4. ‘마이크가 준비됐어요’ 이후 ‘이따야, 근처 만원 이하 식당 찾아줘’를 말한다.
5. 음성 답변을 마친 뒤 별도 재연결 없이 ‘이따야, 여기로 길 안내해줘’를 말하고 들은 말과 안내 시작을 확인한다.
6. 근처 도착 추정 뒤 전화 제안에 “응”이라고 답해 DB 번호의 전화 앱 연결 요청을 확인한다. 실제 발신은 OS 확인 절차를 따른다. 전화 앱에서 사이트로 돌아오면 버튼 없이 다시 듣는지 확인한다. 화면 잠금·앱 전환·전화 사용 중 지속 수신/백그라운드 내비게이션은 보장하지 않는다.

## 실행 및 환경변수

- 기존 frontend 폴더에서 `npm run dev` 또는 `npm run build`를 실행한다. `finder.html`이 지도/음성 화면이다.
- frontend 관련 검사: `node --test tests/guideLocation.test.ts tests/arrivalAssist.test.ts tests/mobileMicrophone.test.ts tests/recordedHandsFree.test.ts tests/guideSpeech.test.ts`
- backend 관련 검사: backend 폴더에서 `node --test navigation.test.js guideAi.test.js`
- 새 환경변수나 의존성은 없다. 기존 `VITE_API_BASE_URL`, 서버 `GROQ_API_KEY`, `GUIDE_TEXT_MODEL`(미설정 시 기존 기본 모델), `TMAP_APP_KEY`, `GUIDE_GOOGLE_TTS_ENABLED`, `GOOGLE_TTS_API_KEY` 또는 Google 인증, `GUIDE_GOOGLE_TTS_VOICE=ko-KR-Chirp3-HD-Aoede` 설정을 유지한다. 키는 기존 서버 비밀 설정에만 두고 Git에 넣지 않는다.

공식 참고:
- https://developer.chrome.com/blog/autoplay
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder
- https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API
- https://developer.android.com/guide/components/intents-common#Phone
- https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/PhoneLinks/PhoneLinks.html
