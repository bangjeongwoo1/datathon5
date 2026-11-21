"""지도 데이터의 가맹점 점(members·cvs)에 영업시간 판정을 붙인다 (2026-11-20, 시간대별 사각지대 테스트용)

    python3 2_코드/영업시간_지도연결.py [지도데이터 폴더] [출력 폴더]   (datathon5-1/mealcard_data 폴더에서)
    예) python3 2_코드/영업시간_지도연결.py 3_결과/v2 3_결과/v2   ← v2 지도 데이터(행안부+팀DB)에 붙일 때
    폴더를 안 주면 3_결과/v2 를 읽고 거기에 쓴다. 만든 hours-*.json은 ../frontend/public/mealcard/ 로 복사해 화면에서 쓴다

입력: 3_결과/v2/map-data*.json, 1_원본데이터/영업시간/merchant_crawl_staging_rows.csv
출력: 3_결과/v2/hours-{key}.json
  { "members": [[평일, 토요일, 공휴일], ...], "cvs": [...], "known": {...}, "source": "..." }
  값: -1 = 영업시간 없음(판정 안 함). 0 이상이면 비트 1=점심(11~14시), 2=저녁(17~20시)에 30분 이상 영업

연결: 지도 가맹점과 staging 가게를
  1) 상호가 같고 150m 안, 또는
  2) 50m 안이고 이름이 비슷(지역명 뺀 앞부분이 같거나 유사도 0.7 이상)
이면 같은 가게로 본다. 못 맞추면 -1(영업시간 모름)로 둔다.
판정 규칙은 영업시간_시간대판정.py와 같다(배달시간 안 씀, 빈 값·시작=끝은 판정 안 함).
"""
import csv, importlib.util, json, math, re, sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("판정", ROOT / "2_코드/영업시간_시간대판정.py")
J = importlib.util.module_from_spec(spec)
spec.loader.exec_module(J)

CITIES = [("춘천시", "chuncheon", "map-data.json"), ("원주시", "wonju", "map-data-wonju.json"),
          ("강릉시", "gangneung", "map-data-gangneung.json"), ("홍천군", "hongcheon", "map-data-hongcheon.json")]
BITS = [("점심", 1), ("저녁", 2)]
STRIP = re.compile(r"주식회사|유한회사|강원특별자치도|강원도|강원|춘천|원주|강릉|홍천|직영|본점|식당|음식점")


def norm(s):
    s = re.sub(r"\(.*?\)", "", str(s))
    s = STRIP.sub("", s.lower())
    return re.sub(r"[^0-9a-z가-힣]", "", s)


def similar(a, b):
    if not a or not b:
        return 0.0
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and long_.startswith(short):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def dist(y1, x1, y2, x2):
    p = math.radians((y1 + y2) / 2)
    return math.hypot((y2 - y1) * 111320, (x2 - x1) * 111320 * math.cos(p))


def code(row):
    out = []
    for _, o, c in J.DAYS:
        res, _why = J.judge(row[o], row[c])
        out.append(-1 if res is None else sum(bit for k, bit in BITS if res[k]))
    return out


def main():
    src = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "3_결과/v2")
    dst = ROOT / (sys.argv[2] if len(sys.argv) > 2 else "3_결과/v2")
    rows = list(csv.DictReader(open(ROOT / "1_원본데이터/영업시간/merchant_crawl_staging_rows.csv", encoding="utf-8-sig")))
    for city, key, fname in CITIES:
        d = json.load(open(src / fname, encoding="utf-8"))
        st = []
        for r in rows:
            if r["signguNm"] != city or not r["latitude"]:
                continue
            c = code(r)
            if all(v == -1 for v in c):
                continue   # 영업시간이 하나도 없는 가게는 쓰지 않는다
            st.append((float(r["latitude"]), float(r["longitude"]), norm(r["mrhstNm"]), c))
        grid = {}
        for s in st:
            grid.setdefault((round(s[0], 2), round(s[1], 2)), []).append(s)

        def find(y, x, name):
            n = norm(name)
            best = None
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for s in grid.get((round(round(y, 2) + dy / 100, 2), round(round(x, 2) + dx / 100, 2)), []):
                        dd = dist(y, x, s[0], s[1])
                        ok = (s[2] == n and dd <= 150) or (dd <= 50 and similar(n, s[2]) >= 0.7)
                        if ok and (best is None or dd < best[0]):
                            best = (dd, s[3])
            return best[1] if best else [-1, -1, -1]

        mem = [find(p[0], p[1], p[2]) for p in d["members"]]
        cvs = [find(p[0], p[1], p[2]) for p in d["cvs"]]
        known = {"members": sum(1 for v in mem if v[0] != -1), "members_all": len(mem),
                 "cvs": sum(1 for v in cvs if v[0] != -1), "cvs_all": len(cvs)}
        out = {"members": mem, "cvs": cvs, "known": known,
               "source": "팀 Supabase merchant_crawl_staging(네이버 지도 크롤링·일부 표준데이터 원래 값, 2026-11-20 내려받음). 배달시간 제외, 빈 값 제외."}
        json.dump(out, open(dst / f"hours-{key}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(city, f"영업시간 있는 staging {len(st)}곳 → 지도 가맹 식당 {known['members']}/{known['members_all']}, 편의점 {known['cvs']}/{known['cvs_all']} 연결")


if __name__ == "__main__":
    main()
