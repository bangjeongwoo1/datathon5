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
