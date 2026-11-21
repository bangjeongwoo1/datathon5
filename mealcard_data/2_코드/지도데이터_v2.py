"""가맹 권유 지도 데이터 v2: 행안부 인허가 2종 + 팀 DB 가맹점 + 학교 (2026-11-20)

    python3 2_코드/지도데이터_v2.py        (datathon5-1/mealcard_data 폴더에서. 4개 시군을 한 번에)
    결과(3_결과/v2/map-data*.json)는 ../frontend/public/mealcard/ 로 복사해 화면에서 쓴다

팀 결정으로 식당·가맹점 자료를 바꾼다.
- 식당 목록: 행정안전부 식품 일반음식점(data.go.kr 15154916, 영업 중) + 식품 휴게음식점(강원 파일, 영업/정상)
- 가맹점: 팀 Supabase merchants 표(merchants_rows.csv). category 음식점 = 식사형 가맹 식당, 편의점 = 편의점 가맹점
- 학교: 전국초중등학교위치표준데이터(15021148), 운영 중
- 시군 경계·읍면동 목록은 예전 지도 데이터(1_원본데이터/기존_지도데이터)의 것을 그대로 쓴다. 점의 읍면동은 가장 가까운 상가정보 점의 행정동으로 붙인다
  (상가정보 강원 202606에서 4개 시군의 행정동·좌표만 뽑은 1_원본데이터/행정동_기준점_상가정보202606.csv. 레포 data/의 상가정보 파일은 한글이 깨져 있어 쓰지 않는다)

권유 식당 규칙(춘천과 같게)
- 일반음식점: 업태가 식사형(MEAL)인 곳만. 술집 업태(BAR)는 뺀다. 단 "호프/통닭"이어도 상호가 프랜차이즈 치킨 브랜드면 살린다
- 휴게음식점: 업태 패스트푸드·일반조리판매만 (춘천 MEAL에 있는 휴게 업태). 커피숍·다방·편의점·과자점·아이스크림·기타 휴게음식점 등은 뺀다
- 상호에 비식당·술집 표현이 있으면 뺀다
- 블로그 검사(카카오 블로그 상위 5개 글)에서 그 가게 글에 술집 표현(맥주·비어 제외)이 2번 이상 나오면 뺀다
- 팀 DB 가맹점(좌표 있는 곳 전부, 업종 무관)과 같은 가게면 가맹으로 보고 뺀다: 상호가 같고 150m 안, 또는 50m 안에서 이름이 비슷
- 같은 건물(도로명+건물번호)에 가맹점이 있는데 이름이 안 맞는 곳도 가맹일 수 있어 뺀다(기존 규칙)
- 학교 1km 안이고 가장 가까운 가맹점(편의점 포함/미포함)이 반경 R 밖이면 권유
팀 확인 제외 목록(1_원본데이터/팀확인_제외업소.csv, 예: 춘천 한량=술집)에 있는 가맹점은 가맹 원에서, 같은 상호의 식당은 권유 후보에서 뺀다.
좌표 없는 가맹점(merchants에서 latitude 빈 곳)은 같은 상호의 인허가 식당과 맞춰(같은 동 → 같은 도로명주소 → 시군에 한 곳뿐) 그 좌표를 쓰고, 못 맞추면 뺀다.
"""
import csv, importlib.util, json, re
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
import numpy as np, pandas as pd

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent   # datathon5-1
OUT = ROOT / "3_결과/v2"
RADII = [100, 200, 300, 400, 500]
SCHOOL_R = 1000

spec = importlib.util.spec_from_file_location("lic", ROOT / "2_코드/인허가_업태_맞추기.py")
LIC = importlib.util.module_from_spec(spec)
spec.loader.exec_module(LIC)

CITIES = [("춘천시", "chuncheon", "map-data.json", "4181000"), ("원주시", "wonju", "map-data-wonju.json", "4191000"),
          ("강릉시", "gangneung", "map-data-gangneung.json", "4201000"), ("홍천군", "hongcheon", "map-data-hongcheon.json", "4251000")]
MEAL = {"한식", "식육(숯불구이)", "분식", "중국식", "경양식", "통닭(치킨)", "탕류(보신용)", "일식", "횟집", "패스트푸드", "김밥(도시락)",
        "외국음식전문점(인도,태국등)", "뷔페식", "냉면집", "복어취급", "패밀리레스트랑", "일반조리판매"}
BAR = {"호프/통닭", "정종/대포집/소주방", "라이브카페", "감성주점"}
REST_MEAL = {"패스트푸드", "일반조리판매"}
NOT_RESTAURANT_NAME = r"골프|호텔|리조트|온천|콘도|펜션|민박|장례식장|직원식당|구내식당|매점|케이터링|출장|웨딩|컨벤션|이벤트|연회|카페|커피|cafe|coffee|PC|피씨|스크린|문구|마트|편의점"
PUB_NAME = r"포차|주점|술집|이자카야|호프|맥주|비어|펍|바텐더|한잔술"
# 프랜차이즈 치킨집: 신고 업태가 "호프/통닭"이어도, 상호가 치킨 브랜드면 식당으로 살린다(팀 결정 2026-11-20).
# 술집 거르기 ②상호·③블로그에서도 빼지 않는다
CHICKEN_BRAND = (r"bbq|비비큐|bhc|비에이치씨|비에치씨|교촌|굽네|네네치킨|처갓집|페리카나|또래오래|호식이|멕시카나|멕시칸치킨|60계|노랑통닭|푸라닭|자담치킨|자담|"
                 r"깐부|지코바|땅땅치킨|바른치킨|kfc|케이에프씨|부어치킨|오븐에빠진닭|또봉이|기영이|맛닭꼬|썬더치킨|치킨마루|둘둘치킨|코리엔탈|훌랄라|꾸브라꼬|"
                 r"순수치킨|아웃닭|후라이드참잘하는|후참잘|가마치|디디치킨|치킨공주|치킨플러스|명랑통닭|명랑치킨|장모님치킨|동키치킨|쌀통닭|신통치킨|삼통치킨|깻잎두마리")
# 블로그 검사(2_코드/블로그_술집검사.py 결과): 상위 5개 글 중 그 가게 글에 술집 표현(맥주·비어 제외)이 이만큼 이상 나오면 술집으로 보고 뺀다
BLOG_MIN = 2
STRIP = re.compile(r"주식회사|유한회사|강원특별자치도|강원도|강원|춘천|원주|강릉|홍천|직영|본점|식당|음식점")
R_E = 6371000.0


def norm(s):
    s = re.sub(r"\(.*?\)", "", str(s))
    return re.sub(r"[^0-9a-z가-힣]", "", STRIP.sub("", s.lower()))


def similar(a, b):
    if not a or not b:
        return 0.0
    short, long_ = sorted((a, b), key=len)
    if len(short) >= 3 and long_.startswith(short):
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def road_key(addr):
    m = re.search(r"([가-힣0-9]+(?:로|길)(?:\s?\d+(?:번)?길)?)\s?(\d+(?:-\d+)?)", str(addr))
    return re.sub(r"\s", "", m.group(1)) + " " + m.group(2) if m else None


def dong_name(addr, city):
    """주소에서 읍·면·동 이름. 괄호 안(도로명주소의 '(후평동)')을 먼저, 없으면 시군 바로 뒤 낱말"""
    a = str(addr)
    m = re.search(r"\(([가-힣0-9]+(?:읍|면|동|가))[,)]", a)
    if m:
        return m.group(1)
    m = re.search(city + r"\s*([가-힣0-9]+(?:읍|면|동|가))(?=\s|$)", a)
    return m.group(1) if m else None


def hav(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = (np.radians(np.asarray(v, float)) for v in (lat1, lon1, lat2, lon2))
    a = np.sin((lat2[None, :] - lat1[:, None]) / 2) ** 2 + np.cos(lat1[:, None]) * np.cos(lat2[None, :]) * np.sin((lon2[None, :] - lon1[:, None]) / 2) ** 2
    return 2 * R_E * np.arcsin(np.sqrt(a))


def min_dist(lat1, lon1, lat2, lon2, chunk=500):
    if len(lat2) == 0:
        return np.full(len(lat1), np.inf)
    out = []
    for s in range(0, len(lat1), chunk):
        out.append(hav(lat1[s:s + chunk], lon1[s:s + chunk], lat2, lon2).min(1))
    return np.concatenate(out) if out else np.array([])


def to_wgs(df, xcol, ycol):
    ys, xs = [], []
    for x, y in zip(df[xcol], df[ycol]):
        try:
            la, lo = LIC.epsg5174_to_wgs84(float(x), float(y))
        except (TypeError, ValueError):
            la = lo = np.nan
        ys.append(la)
        xs.append(lo)
    df["위도"], df["경도"] = ys, xs
    return df


def load_restaurants(city, code):
    g = pd.read_csv(ROOT / f"1_원본데이터/인허가_일반음식점/일반음식점_인허가_{city}_영업중_20261119.csv", dtype=str, encoding="utf-8-sig")
    g = g.rename(columns={"BPLC_NM": "업소명", "BZSTAT_SE_NM": "업태", "ROAD_NM_ADDR": "도로명주소", "LOTNO_ADDR": "지번주소", "CRD_INFO_X": "X", "CRD_INFO_Y": "Y", "MNG_NO": "관리번호"})
    g["구분"] = "일반음식점"
    h = pd.read_csv(ROOT / "1_원본데이터/휴게음식점/식품_휴게음식점_강원특별자치도.csv", dtype=str, encoding="cp949")
    h = h[(h["개방자치단체코드"] == code) & (h["영업상태명"] == "영업/정상")]
    h = h.rename(columns={"사업장명": "업소명", "업태구분명": "업태", "좌표정보(X)": "X", "좌표정보(Y)": "Y"})
    h["구분"] = "휴게음식점"
    cols = ["관리번호", "업소명", "업태", "도로명주소", "지번주소", "X", "Y", "구분"]
    df = pd.concat([g[cols], h[cols]], ignore_index=True)
    return to_wgs(df, "X", "Y")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    mer = pd.read_csv(ROOT / "1_원본데이터/팀DB/merchants_rows.csv", dtype=str, encoding="utf-8-sig")
    # 팀이 직접 확인해 뺄 업소(술집 등). 가맹점이면 가맹 원에서, 식당이면 권유 후보에서 뺀다
    excl = pd.read_csv(ROOT / "1_원본데이터/팀확인_제외업소.csv", dtype=str, encoding="utf-8-sig").fillna("")
    schools_all = pd.read_csv(REPO / "data/전국초중등학교위치표준데이터.csv", dtype=str, encoding="cp949")
    sg_all = pd.read_csv(ROOT / "1_원본데이터/행정동_기준점_상가정보202606.csv", dtype=str, encoding="utf-8-sig",
                         usecols=["시군구명", "행정동코드", "행정동명", "위도", "경도"])
    report = {}
    for city, key, fname, code in CITIES:
        old = json.load(open(ROOT / "1_원본데이터/기존_지도데이터" / fname, encoding="utf-8"))
        st = {"city": city}
        # ── 식당 (행안부 2종) ──
        lic = load_restaurants(city, code)
        st["일반음식점"] = int((lic["구분"] == "일반음식점").sum())
        st["휴게음식점"] = int((lic["구분"] == "휴게음식점").sum())
        st["휴게_업태"] = lic.loc[lic["구분"] == "휴게음식점", "업태"].value_counts().to_dict()
        lic = lic[lic["위도"].notna()].copy()
        lic["n"] = lic["업소명"].map(norm)
        lic["rk"] = lic["도로명주소"].map(road_key)
        lic["동"] = lic["지번주소"].map(lambda a: dong_name(a, city))

        # ── 가맹점 (팀 DB) ──
        m = mer[mer["region"] == city].copy()
        ex = excl[excl["시군"] == city]
        drop = m["merchant_id"].isin(set(ex["merchant_id"]) - {""})
        st["팀확인_제외_가맹점"] = m.loc[drop, "name"].tolist()
        m = m[~drop].copy()
        st["DB가맹점"] = len(m)
        st["DB가맹점_좌표없음"] = int(m["latitude"].isna().sum())
        m["n"] = m["name"].map(norm)
        m["rk"] = m["address"].map(road_key)
        # 좌표 없는 가맹점: 같은 상호의 인허가 식당과 맞춰 그 좌표를 쓴다 (2026-11-20, 예: 춘천 홍해아)
        #   ① 같은 읍·면·동 → ② 같은 도로명+건물번호 → ③ 시군 안에 그 상호가 한 곳뿐. 못 맞추면 뺀다
        fill, how = [], Counter()
        for _, r in m[m["latitude"].isna()].iterrows():
            same = lic[lic["n"] == r["n"]] if r["n"] else lic.iloc[0:0]
            dn, rk = dong_name(r["address"], city), r["rk"]
            pick, rule = None, None
            if len(same) and dn and (same["동"] == dn).any():
                pick, rule = same[same["동"] == dn].iloc[0], "①같은 동"
            elif len(same) and rk and (same["rk"] == rk).any():
                pick, rule = same[same["rk"] == rk].iloc[0], "②같은 도로명주소"
            elif len(same) == 1:
                pick, rule = same.iloc[0], "③시군에 한 곳뿐"
            how[rule or "못 맞춤"] += 1
            if pick is not None:
                rr = r.copy()
                rr["latitude"], rr["longitude"] = pick["위도"], pick["경도"]
                fill.append(rr)
        st["좌표없는가맹점_맞춤"] = dict(how)
        m = pd.concat([m[m["latitude"].notna()], pd.DataFrame(fill)], ignore_index=True) if fill else m[m["latitude"].notna()].copy()
        m[["위도", "경도"]] = m[["latitude", "longitude"]].astype(float)
        m = m.drop_duplicates(["n", "위도", "경도"]).reset_index(drop=True)   # DB에 같은 가게가 두 줄인 경우(예: 홍해아 CC-004249·004451)
        meal = m[m["category"] == "음식점"].reset_index(drop=True)
        cvs = m[m["category"] == "편의점"].reset_index(drop=True)
        st["가맹식당"], st["편의점가맹"] = len(meal), len(cvs)

        lic["치킨브랜드"] = lic["업소명"].str.contains(CHICKEN_BRAND, case=False, na=False)
        chicken_hof = (lic["구분"] == "일반음식점") & (lic["업태"] == "호프/통닭") & lic["치킨브랜드"]
        ok_type = ((lic["구분"] == "일반음식점") & lic["업태"].isin(MEAL)) | ((lic["구분"] == "휴게음식점") & lic["업태"].isin(REST_MEAL)) | chicken_hof
        st["술집업태_뺌"] = int(((lic["구분"] == "일반음식점") & lic["업태"].isin(BAR) & ~chicken_hof).sum())
        st["프랜차이즈치킨_살림"] = int(chicken_hof.sum())
        st["일반_기타업태_뺌"] = int(((lic["구분"] == "일반음식점") & ~lic["업태"].isin(MEAL | BAR)).sum())
        cand = lic[ok_type].copy()
        name_bad = cand["업소명"].str.contains(NOT_RESTAURANT_NAME, case=False, na=False) | (cand["업소명"].str.contains(PUB_NAME, case=False, na=False) & ~cand["치킨브랜드"])
        st["상호로_뺌"] = int(name_bad.sum())
        cand = cand[~name_bad].reset_index(drop=True)
        ex_n = {norm(x) for x in ex["상호"]}
        st["팀확인_제외_식당"] = int(cand["업소명"].map(norm).isin(ex_n).sum())
        cand = cand[~cand["업소명"].map(norm).isin(ex_n)].reset_index(drop=True)
        # 3단계: 블로그 검사에서 술집으로 나온 곳 (검사 결과가 없으면 이 단계는 건너뛴다)
        bf = ROOT / f"3_결과/블로그_술집검사/{city}.csv"
        if bf.exists():
            b = pd.read_csv(bf, dtype=str, encoding="utf-8-sig")
            blog_bar = set(b.loc[b["술집표현_맥주비어제외"].astype(int) >= BLOG_MIN, "상호"].map(norm))
            hit = cand["업소명"].map(norm).isin(blog_bar) & ~cand["치킨브랜드"]
            st["블로그검사_뺌"] = int(hit.sum())
            cand = cand[~hit].reset_index(drop=True)
        cand["n"] = cand["업소명"].map(norm)
        cand["rk"] = cand["도로명주소"].map(road_key)

        # 가맹점과 같은 가게인지 (좌표 있는 가맹점 전부)
        d = hav(cand["위도"].values, cand["경도"].values, m["위도"].values, m["경도"].values) if len(m) else np.zeros((len(cand), 0))
        is_mem = np.zeros(len(cand), bool)
        mn = m["n"].values
        for i in range(len(cand)):
            near = np.where(d[i] <= 150)[0]
            for j in near:
                if mn[j] == cand.at[i, "n"] or (d[i, j] <= 50 and similar(cand.at[i, "n"], mn[j]) >= 0.7):
                    is_mem[i] = True
                    break
        st["식당중_가맹으로맞춤"] = int(is_mem.sum())
        mem_rk = set(m["rk"].dropna())
        same_bldg = (~is_mem) & cand["rk"].isin(mem_rk).values
        st["같은건물_가맹있어_뺌"] = int(same_bldg.sum())
        non = cand[~is_mem & ~same_bldg].reset_index(drop=True)
        st["미가맹식당"] = len(non)

        # ── 학교 ──
        sc = schools_all[schools_all["소재지도로명주소"].str.contains(city, na=False) & (schools_all["운영상태"] == "운영")].copy()
        sc[["위도", "경도"]] = sc[["위도", "경도"]].astype(float)
        sc["읍면동"] = sc["소재지지번주소"].str.extract(city + r"\s+([가-힣0-9]+(?:읍|면|동|가))")[0].fillna("")
        sc = sc.reset_index(drop=True)
        st["학교"] = len(sc)

        # ── 읍면동 코드: 가장 가까운 상가정보 점 ──
        sg = sg_all[sg_all["시군구명"] == city].dropna(subset=["위도", "경도"]).copy()
        sg[["위도", "경도"]] = sg[["위도", "경도"]].astype(float)
        sg = sg.sample(min(len(sg), 4000), random_state=1)
        valid = {x["c"] for x in old["dongs"]}
        sg = sg[sg["행정동코드"].str[:8].isin(valid) | sg["행정동코드"].isin(valid)]

        def dong_of(df):
            if not len(df):
                return []
            out = []
            for s in range(0, len(df), 400):
                part = df.iloc[s:s + 400]
                dd = hav(part["위도"].values, part["경도"].values, sg["위도"].values, sg["경도"].values)
                out.extend(sg["행정동코드"].values[dd.argmin(1)])
            return [c[:8] if c[:8] in valid else c for c in out]
        for df in (sc, meal, cvs, non):
            df["동코드"] = dong_of(df)

        # ── 권유 계산 ──
        d_school_non = hav(sc["위도"].values, sc["경도"].values, non["위도"].values, non["경도"].values) if len(non) else np.zeros((len(sc), 0))
        sc["m"] = min_dist(sc["위도"].values, sc["경도"].values, meal["위도"].values, meal["경도"].values)
        sc["u"] = d_school_non.min(1) if len(non) else 99999
        in_school = d_school_non <= SCHOOL_R
        sets = {"미포함": meal, "포함": pd.concat([meal, cvs], ignore_index=True)}
        recs, rec_summary = [], []
        k1, rc = {}, {}
        for mode, mem in sets.items():
            d_non_mem = min_dist(non["위도"].values, non["경도"].values, mem["위도"].values, mem["경도"].values)
            k1[mode] = (hav(sc["위도"].values, sc["경도"].values, mem["위도"].values, mem["경도"].values) <= SCHOOL_R).sum(1) if len(mem) else np.zeros(len(sc), int)
            rc[mode] = {}
            for r in RADII:
                ok = in_school & (d_non_mem > r)[None, :]
                rc[mode][r] = ok.sum(1)
                rec_summary.append({"편의점": mode, "가맹원반경_m": r, "권유식당": int(ok.any(0).sum()), "권유식당있는학교": int((ok.sum(1) > 0).sum())})
                rows = []
                for j in np.where(ok.any(0))[0]:
                    near = np.where(ok[:, j])[0]
                    k = near[np.argmin(d_school_non[near, j])]
                    c = non.iloc[j]
                    dm = d_non_mem[j]
                    rows.append([mode, r, 0, round(c["위도"], 5), round(c["경도"], 5), c["업소명"], c["업태"], sc.at[k, "학교명"],
                                 int(round(d_school_non[k, j])), int(round(dm)) if np.isfinite(dm) else 99999, c["도로명주소"] or c["지번주소"] or "", c["동코드"]])
                rows.sort(key=lambda x: -x[9])
                for i, x in enumerate(rows):
                    x[2] = i + 1
                recs += rows
        st["권유_미포함_100m"] = rec_summary[0]["권유식당"]
        st["권유있는학교_미포함_100m"] = rec_summary[0]["권유식당있는학교"]

        r5 = lambda v: round(float(v), 5)
        fin = lambda v: int(round(v)) if np.isfinite(v) else 99999
        data = {
            "city": city,
            "title": f"{city[:2]} 급식카드 가맹 권유 지도",
            "rules": "행정안전부 식품 인허가의 일반음식점 중 식사형 업태(한식·분식·중국식·경양식·통닭·일식·횟집 등)와 휴게음식점 중 패스트푸드·일반조리판매만 봤어요. "
                     "술집 업태(호프/통닭·소주방·감성주점·라이브카페)와 상호에 술집·비식당 표현이 있는 곳은 뺐어요. 팀 DB 가맹점과 같은 가게이거나 같은 건물에 가맹점이 있는 곳도 뺐어요.",
            "sources": "행정안전부_식품_일반음식점 조회서비스(15154916, 2026-11-19 영업 중), 행정안전부 식품 휴게음식점 인허가(강원, 영업/정상), "
                       "급식카드 가맹점은 팀 DB merchants(2026-11-20, 좌표 있는 곳), 초중등학교위치표준데이터(15021148). "
                       f"{city} 경계 © OpenStreetMap 기여자(ODbL). 지도 © Kakao. 거리는 직선거리.",
            "boundary": old["boundary"],
            "radii": RADII,
            "schools": [{"n": s["학교명"], "k": s["학교급구분"], "d": s["읍면동"], "y": r5(s["위도"]), "x": r5(s["경도"]),
                         "m": fin(s["m"]), "u": fin(s["u"]) if np.isfinite(s["u"]) else 99999,
                         "k1": {mo: int(k1[mo][i]) for mo in sets}, "rc": {mo: {str(r): int(rc[mo][r][i]) for r in RADII} for mo in sets}, "g": s["동코드"]}
                        for i, s in sc.iterrows()],
            "members": [[r5(c["위도"]), r5(c["경도"]), c["name"], "음식점", c["동코드"]] for _, c in meal.iterrows()],
            "cvs": [[r5(c["위도"]), r5(c["경도"]), c["name"], c["동코드"]] for _, c in cvs.iterrows()],
            "non": [[r5(c["위도"]), r5(c["경도"]), c["업소명"], c["업태"], c["동코드"]] for _, c in non.iterrows()],
            "recs": recs,
            "recSummary": rec_summary,
            "dongs": old["dongs"],
            "schoolR": SCHOOL_R,
        }
        (OUT / fname).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        # 비교용: 지금(기존) 지도 데이터
        os_ = next(x for x in old["recSummary"] if x["편의점"] == "미포함" and x["가맹원반경_m"] == 100)
        st["기존"] = {"가맹식당": len(old["members"]), "편의점가맹": len(old["cvs"]), "미가맹식당": len(old["non"]), "학교": len(old["schools"]),
                     "권유_미포함_100m": os_["권유식당"], "권유있는학교_미포함_100m": os_["권유식당있는학교"]}
        report[city] = st
        print(json.dumps(st, ensure_ascii=False))
    (OUT / "비교_요약.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
