"""가맹점 영업시간으로 점심·저녁에 여는지 판정 (2026-11-20)

    python3 2_코드/영업시간_시간대판정.py        (datathon5-1/mealcard_data 폴더에서)

입력: 1_원본데이터/영업시간/merchant_crawl_staging_rows.csv
      (팀 Supabase merchant_crawl_staging 표를 내려받은 것. 팀 결정으로 merchant_naver_info 대신 이 표를 쓴다)
출력: 3_결과/영업시간/가맹점_시간대판정.csv, 3_결과/영업시간/시간대판정_요약.csv

규칙 (팀 결정, 2026-11-20 수정)
- 점심 11:00~14:00, 저녁 17:00~20:00
- 그 시간대 안에 30분 이상 영업하면 연다 (예전 "1시간 이상"·"내내" 두 기준은 없앰)
- 배달시간은 쓰지 않는다. 시작·끝 중 하나라도 비어 있으면 그 요일은 판정하지 않는다(값이 있는 것만 쓴다)
- 끝 < 시작이면 자정을 넘겨 다음 날 닫는 것으로 본다 (예: 17:00~02:00). 전날 밤부터 이어진 영업도 본다
- 시작 = 끝(예: 00:00~00:00)은 24시간인지 휴무인지 알 수 없어 판정하지 않는다
"""
import csv
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "1_원본데이터/영업시간/merchant_crawl_staging_rows.csv"
OUT = ROOT / "3_결과/영업시간"
DAYS = [("평일", "weekdayOperOpenHhmm", "weekdayOperColseHhmm"),
        ("토요일", "satOperOperOpenHhmm", "satOperCloseHhmm"),
        ("공휴일", "holidayOperOpenHhmm", "holidayCloseOpenHhmm")]
SLOTS = [("점심", 11 * 60, 14 * 60), ("저녁", 17 * 60, 20 * 60)]
MIN_OPEN = 30  # 시간대 안에서 이만큼(분) 이상 열면 연 것으로 본다


def minutes(t):
    h, m = t.strip().split(":")
    return int(h) * 60 + int(m)


def intervals(o, c):
    """영업 구간(분). 자정 넘김이면 오늘 저녁~내일, 그리고 전날 밤~오늘 새벽 구간을 함께 돌려준다."""
    a, b = minutes(o), minutes(c)
    if b > a:
        return [(a, b)]
    return [(a, b + 1440), (a - 1440, b)]


def judge(o, c):
    """{시간대: True/False}. 판정 못 하면 None과 이유"""
    if not o.strip() or not c.strip():
        return None, "값 없음"
    if minutes(o) == minutes(c):
        return None, "시작=끝"
    iv = intervals(o, c)
    res = {}
    for name, s, e in SLOTS:
        over = max(max(0, min(e, b) - max(s, a)) for a, b in iv)
        res[name] = over >= MIN_OPEN
    return res, "판정"


def main():
    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
    OUT.mkdir(parents=True, exist_ok=True)
    out, summary = [], Counter()
    for r in rows:
        kind = "편의점" if r["Cuisine"].strip() == "편의점" else "편의점 외"
        rec = {"crawl_id": r["merchant_id"], "상호": r["mrhstNm"], "시군": r["signguNm"], "주소": r["rdnmadr"],
               "위도": r["latitude"], "경도": r["longitude"], "네이버업종": r["Cuisine"], "구분": kind,
               "네이버기반판별": r["네이버기반판별"], "수집상태": r["수집상태"]}
        for day, o, c in DAYS:
            res, why = judge(r[o], r[c])
            rec[f"{day}_영업"] = f"{r[o].strip()}~{r[c].strip()}" if why != "값 없음" else ""
            rec[f"{day}_판정"] = why
            for name, _, _ in SLOTS:
                v = "" if res is None else ("O" if res[name] else "X")
                rec[f"{day}_{name}"] = v
                if res is not None:
                    summary[(r["signguNm"], kind, day, name, f"{MIN_OPEN}분이상", v)] += 1
            summary[(r["signguNm"], kind, day, "판정", why, "")] += 1
        out.append(rec)
    with open(OUT / "가맹점_시간대판정.csv", "w", encoding="utf-8-sig", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    with open(OUT / "시간대판정_요약.csv", "w", encoding="utf-8-sig", newline="") as fp:
        w = csv.writer(fp)
        w.writerow(["시군", "구분", "요일", "시간대", "기준", "값", "곳수"])
        for k, v in sorted(summary.items()):
            w.writerow([*k, v])
    return out


if __name__ == "__main__":
    main()
