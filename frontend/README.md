# 오늘 뭐 먹지 · 가맹점 찾기

춘천시 아동급식카드 가맹점을 검색하고 카카오맵에서 위치를 확인하는 React 웹 애플리케이션입니다.

## 기술 구성

- React, TypeScript, Vite, CSS
- 카카오맵 JavaScript SDK
- 카카오 로컬 REST API(주소·상호명 기반 좌표 보완용)

## 실행

`frontend` 폴더에 `.env.local` 파일을 만들고 아래처럼 설정합니다.

```env
VITE_KAKAO_MAP_APP_KEY=카카오_JavaScript_키
KAKAO_REST_API_KEY=카카오_REST_API_키
```

- JavaScript 키는 브라우저에서 사용하므로 카카오디벨로퍼스의 JavaScript SDK 도메인에 개발 주소를 등록해야 합니다. 예: `http://localhost:5173`, 내부 IP로 접속한다면 `http://192.168.x.x:5173`
- REST 키에는 `VITE_` 접두사를 붙이지 않습니다. React 코드에서 REST 키를 사용하지 않습니다.

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

## 가맹점 데이터 갱신

원본은 `data/A_가맹점_좌표통합.csv`이며, 원본 파일은 수정하지 않습니다. 좌표가 비어 있는 행은 카카오 REST API로 보완 CSV를 만들 수 있습니다.

```powershell
# 프로젝트 최상위 폴더에서 실행
node --env-file=frontend/.env.local scripts/geocode_missing_coordinates.mjs

# 보완 CSV가 있으면 우선 사용해 React 데이터를 생성
& "$env:LOCALAPPDATA\Python\bin\python.exe" scripts\generate_merchants.py
```

`geocode_missing_coordinates.mjs`는 이미 생성된 `_보완.csv`가 있으면 그 파일을 다시 읽어 좌표가 없는 행만 재시도합니다. 주소 검색 결과가 없을 때는 춘천시 범위의 상호명 검색을 시도하며, 상호명과 주소가 함께 일치하는 후보만 저장합니다.

## 지도 표시 정책

- 생성 데이터에 저장된 위도·경도가 모두 있는 매장만 마커와 숫자 군집으로 표시합니다.
- 위치를 확인하지 못한 매장은 검색·목록에는 표시하지만 지도 마커에서는 제외합니다.
- 지도는 축소 시 가까운 마커를 숫자 군집으로 묶습니다. 군집을 누르면 해당 가맹점만 왼쪽 목록에서 볼 수 있습니다.
- GPS 위치는 수집하지 않으며, 위치 이동 버튼은 춘천시청 기준으로 동작합니다.

## 화면 기능

- 매장명·주소·업종 검색
- 전체·한식·중식·일식·양식·제과점·편의점·마트 필터
- 매장 선택, 지도 확대·축소, 춘천시청 기준 이동
- 모바일 반응형 레이아웃

## 검증

```powershell
cd frontend
node --experimental-strip-types --test tests/*.test.ts
npm.cmd run build
```

주요 파일: `src/App.tsx`(화면), `src/KakaoMap.tsx`(지도), `src/merchants.ts`(검색·필터), `src/data/merchants.generated.ts`(생성 데이터), `scripts/geocode_missing_coordinates.mjs`(좌표 보완).
