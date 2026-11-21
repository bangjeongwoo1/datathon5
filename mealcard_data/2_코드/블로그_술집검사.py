"""미가맹 식당을 카카오(다음) 블로그 검색으로 찾아, 블로그 글에 술집 표현이 나오는지 센다 (2026-11-20, 시험용)

    KAKAO_REST_KEY_FILE=~/.kakao_rest_key python3 2_코드/블로그_술집검사.py        (datathon5-1/mealcard_data 폴더에서)

- 대상: 3_결과/v2/map-data*.json 의 미가맹 식당(non) 전부
- 검색어: "{시군 앞 두 글자} {상호}"  예) 춘천 오오모리. 블로그 상위 5개 글을 본다(정확도순)
- 그 글의 제목·요약에 상호(공백·괄호 뺀 것)가 들어 있는 글만 "이 가게 글"로 센다
- 이 가게 글에 술집 표현(지도데이터_v2.py의 PUB_NAME과 같음)이 몇 번 나오는지 센다
  "맥주"·"비어"는 보통 식당 후기에도 흔해서(치킨에 맥주, 자리가 비어 있다) 따로도 센다
- 지도 데이터에는 반영하지 않는다. 결과는 3_결과/블로그_술집검사/{시군}.csv
- 서비스키는 레포에 두지 않는다(KAKAO_REST_KEY_FILE). 검색 결과 원문은 레포 밖 캐시(CACHE)에만 둔다
"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "3_결과/블로그_술집검사"
CACHE = Path(os.environ.get("BLOG_CACHE", Path.home() / ".cache/mealcard_blog"))
CITIES = [("춘천시", "map-data.json"), ("원주시", "map-data-wonju.json"), ("강릉시", "map-data-gangneung.json"), ("홍천군", "map-data-hongcheon.json")]
PUB = ["포차", "주점", "술집", "이자카야", "호프", "맥주", "비어", "펍", "바텐더", "한잔술"]
WEAK = {"맥주", "비어"}
TOP = 5  # 블로그 상위 몇 개 글을 볼지
TAG = re.compile(r"<[^>]+>")


def norm(s):
    s = re.sub(r"\(.*?\)", "", str(s))
    return re.sub(r"[^0-9a-z가-힣]", "", s.lower())


def main():
    key = Path(os.environ.get("KAKAO_REST_KEY_FILE", "~/.kakao_rest_key")).expanduser().read_text().strip()
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    calls = {"n": 0}

    def search(q):
        f = CACHE / (norm(q) + ".json")
        if f.exists():
            return json.loads(f.read_text())
        url = "https://dapi.kakao.com/v2/search/blog?" + urllib.parse.urlencode({"query": q, "size": TOP})
        req = urllib.request.Request(url, headers={"Authorization": "KakaoAK " + key})
        for t in range(4):
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    d = json.loads(r.read())
                calls["n"] += 1
                f.write_text(json.dumps(d, ensure_ascii=False))
                return d
            except Exception as e:
                code = getattr(e, "code", None)
                if code == 429:
                    sys.exit("카카오 호출 한도 초과. 여기까지 저장했고, 다음에 다시 실행하면 이어서 한다.")
                time.sleep(1 + t)
        return {"documents": [], "error": True}

    for city, fname in CITIES:
        d = json.load(open(ROOT / "3_결과/v2" / fname, encoding="utf-8"))
        rec = {(r[3], r[4], r[5]) for r in d["recs"] if r[0] == "미포함" and r[1] == 100}
        stores = d["non"]
        qs = [f"{city[:2]} {p[2]}" for p in stores]
        with ThreadPoolExecutor(5) as ex:
            res = list(ex.map(search, qs))
        rows = []
        for p, q, r in zip(stores, qs, res):
            n = norm(p[2])
            own = []
            for doc in r.get("documents", [])[:TOP]:
                text = TAG.sub("", doc.get("title", "") + " " + doc.get("contents", ""))
                if n and n in norm(text):
                    own.append((text, doc.get("url", "")))
            hits = {}
            for text, _ in own:
                for w in PUB:
                    if w in text:
                        hits[w] = hits.get(w, 0) + 1
            strong = {w: c for w, c in hits.items() if w not in WEAK}
            ex_url = next((u for t, u in own if any(w in t for w in strong)), next((u for t, u in own if any(w in t for w in hits)), ""))
            rows.append({"상호": p[2], "업태": p[3], "권유식당(100m)": "예" if (p[0], p[1], p[2]) in rec else "",
                         "검색어": q, "블로그글": len(r.get("documents", [])[:TOP]), "이가게글": len(own),
                         "술집표현_전체": sum(hits.values()), "술집표현_맥주비어제외": sum(strong.values()),
                         "나온말": " ".join(f"{w}{c}" for w, c in sorted(hits.items(), key=lambda x: -x[1])),
                         "예시글": ex_url, "오류": "예" if r.get("error") else ""})
        with open(OUT / f"{city}.csv", "w", encoding="utf-8-sig", newline="") as fp:
            w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(city, "미가맹", len(rows), "이가게글있음", sum(1 for x in rows if x["이가게글"]),
              "술집표현(전체)", sum(1 for x in rows if x["술집표현_전체"]), "술집표현(맥주비어제외)", sum(1 for x in rows if x["술집표현_맥주비어제외"]),
              "오류", sum(1 for x in rows if x["오류"]), "| 이번 호출", calls["n"])


if __name__ == "__main__":
    main()
