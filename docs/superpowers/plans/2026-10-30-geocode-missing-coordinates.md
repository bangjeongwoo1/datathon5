# 누락 좌표 보완 구현 계획

**목표:** 원본 가맹점 CSV를 변경하지 않고 주소 기반 좌표를 보완한다.

**구조:** Node 스크립트가 좌표 CSV를 읽어 위도·경도가 없는 행만 카카오 주소 검색 API로 조회한다. 주소 검색에 실패하면 춘천시 범위의 상호명 검색 결과 중 상호명과 주소가 모두 일치하는 결과만 반영한다. 결과는 `_보완.csv`에 저장하며, Python 생성기는 보완 CSV를 우선 사용한다.

**기술:** Node.js 내장 `fetch`·`node:test`, Python 표준 CSV 처리.

## 제약

- REST 키는 `frontend/.env.local`에만 두며 결과 파일이나 Git에 기록하지 않는다.
- 원본 CSV의 모든 컬럼과 행을 보존한다.
- 유효한 기존 위도·경도는 교체하지 않는다.
- 이름 또는 주소가 애매한 장소 검색 결과는 반영하지 않는다.

## 완료 항목

- [x] CSV 파싱·직렬화와 기존 좌표 보존을 테스트했다.
- [x] 주소 검색, 상호명 보조 검색, 재실행 시 보완 CSV 재사용을 구현했다.
- [x] `_보완.csv`를 React 생성 데이터의 우선 입력으로 설정했다.
- [x] 누락 좌표가 있는 행은 지도 마커에서 제외하도록 변경했다.

## 실행 순서

```powershell
node --env-file=frontend/.env.local scripts/geocode_missing_coordinates.mjs
& "$env:LOCALAPPDATA\Python\bin\python.exe" scripts\generate_merchants.py
```

첫 명령을 다시 실행하면 기존 보완 CSV를 읽어 아직 좌표가 없는 행만 재시도한다.
