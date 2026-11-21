"""행정안전부_식품_일반음식점 조회서비스(data.go.kr 15154916)에서 시군별 영업 중 일반음식점을 받는다 (2026-11-19)

    DATAGOKR_KEY_FILE=~/키파일경로 python3 2_코드/인허가_내려받기.py 춘천시 원주시 강릉시 홍천군
    (datathon5-1/mealcard_data 폴더에서)

- 서비스키(일반 인증키 Decoding)는 레포에 두지 않는다. 키 한 줄만 든 파일 경로를 환경변수 DATAGOKR_KEY_FILE로 준다.
- 도로명주소에 "강원특별자치도 {시군}"이 들어간 곳 중 영업상태코드 01(영업)만, 100건씩 받는다.
- 출력: 1_원본데이터/인허가_일반음식점/일반음식점_인허가_{시군}_영업중_{오늘}.csv
  (지도데이터_v2.py는 20261119 파일 이름을 읽는다. 새로 받으면 그쪽 파일 이름도 바꾼다)
"""
import csv, datetime, json, os, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://apis.data.go.kr/1741000/general_restaurants/info?"


def main(cities):
    key_file = os.environ.get("DATAGOKR_KEY_FILE")
    if not key_file:
        sys.exit("환경변수 DATAGOKR_KEY_FILE에 서비스키 파일 경로를 넣어 주세요.")
    key = Path(key_file).expanduser().read_text().strip()
    out = ROOT / "1_원본데이터/인허가_일반음식점"
    out.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().strftime("%Y%m%d")

    def page(addr, n):
        q = {"serviceKey": key, "pageNo": n, "numOfRows": 100, "returnType": "json",
             "cond[ROAD_NM_ADDR::LIKE]": addr, "cond[SALS_STTS_CD::EQ]": "01"}
        err = ""
        for _ in range(4):
            try:
                with urllib.request.urlopen(URL + urllib.parse.urlencode(q), timeout=60) as r:
                    b = json.loads(r.read())["response"]["body"]
                return b["totalCount"], (b["items"]["item"] if b.get("items") else [])
            except Exception as e:  # 키가 화면에 찍히지 않게 가린다
                err = str(e).replace(key, "<키>")
                time.sleep(2)
        sys.exit(f"실패: {addr} {n}쪽 {err}")

    for city in cities:
        addr = f"강원특별자치도 {city}"
        total, rows = page(addr, 1)
        n = 1
        while len(rows) < total:
            n += 1
            _, it = page(addr, n)
            if not it:
                break
            rows += it
        f = out / f"일반음식점_인허가_{city}_영업중_{today}.csv"
        with open(f, "w", encoding="utf-8-sig", newline="") as fp:
            w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(city, "전체", total, "받음", len(rows), "→", f.name)


if __name__ == "__main__":
    main(sys.argv[1:] or ["춘천시", "원주시", "강릉시", "홍천군"])
