"""권유·미가맹 식당(상가정보)을 일반음식점 인허가 자료와 맞춰 신고 업태를 붙인다 (2026-11-19)

    python3 2_코드/인허가_업태_맞추기.py        (datathon5-1/mealcard_data 폴더에서)

입력
- 1_원본데이터/인허가_일반음식점/일반음식점_인허가_{시군}_영업중_20261119.csv
  (행정안전부_식품_일반음식점 조회서비스, data.go.kr 15154916, 영업상태 01=영업)
- 1_원본데이터/기존_지도데이터/map-data-{key}.json (상가정보로 만든 예전 지도 데이터. 그 권유·미가맹 식당에 신고 업태를 붙여 본 검토용)
출력
- 3_결과/{시군}/식당_인허가업태_맞춤.csv  (지도 데이터는 바꾸지 않는다)

맞추는 방법
1) 상호가 같으면(공백·괄호·특수문자 무시) 그 가게. 같은 이름이 여러 곳이면 가장 가까운 곳(100m 안)
2) 아니면 좌표: 30m 안 인허가 가게 중 이름이 비슷한 곳. 지역명·'식당' 같은 말을 빼고 비교해
   유사도 0.7 이상이거나, 한쪽 이름(3글자 이상, 칼국수 같은 흔한 말 제외)으로 다른 쪽 이름이 시작할 때
3) 둘 다 아니면 '못 맞춤' (업태를 짐작하지 않는다)
인허가 좌표는 EPSG:5174(Bessel 1841, 중부원점 TM, 경도 127.0028902777778)라 위도·경도(WGS84)로 바꿔 쓴다.
"""
import csv, json, math, re, sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITIES = [("원주시", "wonju"), ("강릉시", "gangneung"), ("홍천군", "hongcheon")]
BAR = {"호프/통닭", "정종/대포집/소주방", "라이브카페", "감성주점"}  # 춘천 분석과 같은 술집 업태
NAME_R, COORD_R, SIM = 100, 30, 0.7

# ---- EPSG:5174 → WGS84 ----
A_B, F_B = 6377397.155, 1 / 299.1528128           # Bessel 1841
A_W, F_W = 6378137.0, 1 / 298.257223563           # WGS84
LAT0, LON0, K0, FE, FN = math.radians(38), math.radians(127.0028902777778), 1.0, 200000.0, 500000.0
TOWGS = (-115.80, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43)  # EPSG:5174 proj4 towgs84 (위치벡터 방식)


def _meridian(phi, a, e2):
    e4, e6 = e2 * e2, e2 ** 3
    return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))


def tm_inverse(x, y):
    a, e2 = A_B, F_B * (2 - F_B)
    ep2 = e2 / (1 - e2)
    m = _meridian(LAT0, a, e2) + (y - FN) / K0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    n1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2)
    t1, c1 = math.tan(p1) ** 2, ep2 * math.cos(p1) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    d = (x - FE) / (n1 * K0)
    lat = p1 - (n1 * math.tan(p1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4 / 24
                                           + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6 / 720)
    lon = LON0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5 / 120) / math.cos(p1)
    return lat, lon


def to_xyz(lat, lon, a, f):
    e2 = f * (2 - f)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return (n * math.cos(lat) * math.cos(lon), n * math.cos(lat) * math.sin(lon), n * (1 - e2) * math.sin(lat))


def from_xyz(X, Y, Z, a, f):
    e2 = f * (2 - f)
    lon = math.atan2(Y, X)
    p = math.hypot(X, Y)
    lat = math.atan2(Z, p * (1 - e2))
    for _ in range(6):
        n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        lat = math.atan2(Z + e2 * n * math.sin(lat), p)
    return lat, lon


def epsg5174_to_wgs84(x, y):
    lat, lon = tm_inverse(x, y)
    X, Y, Z = to_xyz(lat, lon, A_B, F_B)
    dx, dy, dz, rx, ry, rz, s = TOWGS
    rx, ry, rz = (math.radians(v / 3600) for v in (rx, ry, rz))
    k = 1 + s * 1e-6
    X2 = dx + k * (X - rz * Y + ry * Z)
    Y2 = dy + k * (rz * X + Y - rx * Z)
    Z2 = dz + k * (-ry * X + rx * Y + Z)
    lat, lon = from_xyz(X2, Y2, Z2, A_W, F_W)
    return math.degrees(lat), math.degrees(lon)


# ---- 맞추기 ----
def norm(s):
    s = re.sub(r"\(.*?\)|주식회사|유한회사", "", str(s))
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def dist(y1, x1, y2, x2):
    r = 6371000
    p1, p2 = math.radians(y1), math.radians(y2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(x2 - x1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


# 이름 비교 때 뺄 말: 지역명·흔한 꼬리말 (같은 동네 다른 가게가 비슷하게 나오지 않게)
STRIP = re.compile(r"강원특별자치도|강원도|강원|원주|강릉|홍천|직영|본점|식당|음식점")
# 이 말만 겹치면 같은 가게로 보지 않는다 (예: 손칼국수 ↔ 영옥이칼국수)
GENERIC = {"칼국수", "손칼국수", "김치찌개", "밥상", "집밥", "국밥", "순대국", "막국수", "감자탕", "치킨", "통닭", "삼겹살", "갈비",
           "식육점", "횟집", "가든", "분식", "김밥", "중화요리", "짬뽕", "해장국", "야식", "포차", "숯불", "한우", "고기", "족발", "보쌈",
           "냉면", "곱창", "막창", "닭갈비", "초밥", "돈까스", "카페", "회센터", "수산", "반점"}


def core(n):
    c = STRIP.sub("", n)
    return c if len(c) >= 2 else n


def similar(a, b):
    """두 상호가 같은 가게 이름인지 0~1. 지점명이 붙고 안 붙은 차이(광어한마리 ↔ 광어한마리단계점)는 1.0"""
    a, b = core(a), core(b)
    if not a or not b:
        return 0.0
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and short not in GENERIC and long_.startswith(short):
        return 1.0   # 앞부분(상호 본체)이 같고 뒤에 지점명 등이 붙은 경우만
    return SequenceMatcher(None, a, b).ratio()


def run(city, key):
    lic = []
    for r in csv.DictReader(open(ROOT / f"1_원본데이터/인허가_일반음식점/일반음식점_인허가_{city}_영업중_20261119.csv", encoding="utf-8-sig")):
        y = x = None
        if r["CRD_INFO_X"] and r["CRD_INFO_Y"]:
            y, x = epsg5174_to_wgs84(float(r["CRD_INFO_X"]), float(r["CRD_INFO_Y"]))
        lic.append({"nm": r["BPLC_NM"], "n": norm(r["BPLC_NM"]), "up": r["BZSTAT_SE_NM"], "no": r["MNG_NO"], "addr": r["ROAD_NM_ADDR"] or r["LOTNO_ADDR"], "y": y, "x": x})
    by_name = {}
    for L in lic:
        by_name.setdefault(L["n"], []).append(L)
    grid = {}
    for L in lic:
        if L["y"] is not None:
            grid.setdefault((round(L["y"], 3), round(L["x"], 3)), []).append(L)

    def near(y, x, r):
        out = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for L in grid.get((round(y, 3) + dy / 1000, round(x, 3) + dx / 1000), []):
                    dd = dist(y, x, L["y"], L["x"])
                    if dd <= r:
                        out.append((dd, L))
        return sorted(out, key=lambda t: t[0])

    d = json.load(open(ROOT / f"1_원본데이터/기존_지도데이터/map-data-{key}.json", encoding="utf-8"))
    places = {}
    for r in d["recs"]:
        places[(r[5], round(r[3], 6), round(r[4], 6))] = ("권유", r[6])
    for p in d["non"]:
        places.setdefault((p[2], round(p[0], 6), round(p[1], 6)), ("미가맹", p[3]))

    rows, check = [], []
    for (nm, y, x), (kind, sg) in places.items():
        n = norm(nm)
        how, hit, dd, sc = "못 맞춤", None, None, None
        same = [(dist(y, x, L["y"], L["x"]) if L["y"] is not None else 1e9, L) for L in by_name.get(n, [])]
        same.sort(key=lambda t: t[0])
        if same and (same[0][0] <= NAME_R or (len(same) == 1 and same[0][1]["y"] is None)):
            how, (dd, hit) = "상호 같음", same[0]
            if hit["y"] is not None:
                check.append(dd)
        else:
            cands = [(similar(n, L["n"]), dd_, L) for dd_, L in near(y, x, COORD_R)]
            cands = [c for c in cands if c[0] >= SIM]
            if cands:
                cands.sort(key=lambda t: (-t[0], t[1]))
                sc, dd, hit = cands[0]
                how = "좌표+이름 비슷"
        rows.append({"구분": kind, "상호(상가정보)": nm, "상가정보분류": sg, "위도": y, "경도": x, "맞춘방법": how,
                     "인허가상호": hit["nm"] if hit else "", "신고업태": hit["up"] if hit else "",
                     "술집업태": ("예" if hit and hit["up"] in BAR else "아니오") if hit else "",
                     "거리m": round(dd, 1) if dd is not None and dd < 1e8 else "", "이름유사도": round(sc, 2) if sc is not None else "",
                     "인허가주소": hit["addr"] if hit else "", "관리번호": hit["no"] if hit else ""})
    out = ROOT / f"3_결과/인허가업태_맞춤/{city}.csv"
    with open(out, "w", encoding="utf-8-sig", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    check.sort()
    return rows, check, out


if __name__ == "__main__":
    for city, key in CITIES:
        rows, check, out = run(city, key)
        med = check[len(check) // 2] if check else None
        print(f"\n== {city}: 상호 같은 쌍의 좌표 차이 중앙값 {med:.1f}m, 90% {check[int(len(check) * .9)]:.1f}m (변환 검증, {len(check)}쌍)")
        for kind in ("권유", "미가맹"):
            rs = [r for r in rows if r["구분"] == kind]
            c = {}
            for r in rs:
                c[r["맞춘방법"]] = c.get(r["맞춘방법"], 0) + 1
            bar = sum(r["술집업태"] == "예" for r in rs)
            print(f"  {kind} {len(rs)}곳: {c} · 술집 업태 {bar}곳")
        print("  저장:", out.relative_to(ROOT))
