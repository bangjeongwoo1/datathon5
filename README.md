# 4개 지역 가맹점 주점/비주점 분류

강릉시 / 원주시 / 춘천시 / 홍천군 가맹점 CSV를 하나로 합친 뒤, 네이버 지도에서
업종과 요일별(평일/토/일/배달) 영업시간을 수집해 `주점.csv` / `비주점.csv` /
`검수필요.csv` 세 파일로 분류합니다.

## 실행

```
python build_merchant_master.py
```

`build_merchant_master.py` 안의 `TEST_SAMPLE_PER_FILE` 값으로 지역별 샘플 개수를
조절할 수 있습니다 (0이면 전체 실행).

## 파일 구성

- `build_merchant_master.py` — 메인 스크립트
- `make_hours_csv.py` / `naver_category.py` — `build_merchant_master.py`가 가져다 쓰는
  크롤링 드라이버 생성, 업종 기반 주점 판별 함수가 들어있는 의존 모듈
- `강릉시.csv` / `원주시.csv` / `춘천시.csv` / `홍천군.csv` — 입력 데이터 (중복·업종기타 처리 완료본)

## 필요 패키지

`selenium`, `webdriver-manager` (Microsoft Edge 드라이버 자동 설치)
