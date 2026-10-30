# -*- coding: utf-8 -*-
"""
남은 업소들의 네이버 검색을 통해 영업시간 수집 후 최종 분류
1단계: 치킨 프랜차이즈 매칭 (치킨_브랜드_TOP60.csv)
2단계: 네이버 검색으로 영업시간 확인 → 오후 8시 이후 미영업 업소 식별
출력: 주점관련_검토완료.csv (비주점), A_주점관련_검토후보.csv (주점, 덮어쓰기)
"""
import csv
import re
import os
import json
import urllib.request
import urllib.parse
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def normalize(s):
    s = s.lower()
    s = re.sub(r'[\s\-_·ㆍ&(),.\[\]/]', '', s)
    return s


# ═══════════════════════════════════════════════════════════
# 1단계: 치킨 프랜차이즈 매칭
# ═══════════════════════════════════════════════════════════

CHICKEN_SUFFIXES = [
    '숯불두마리치킨', '두마리치킨', '바베큐치킨',
    '양념치킨', '숯불치킨', '치킨', '통닭', '강정',
]

chicken_brands = []
with open(os.path.join(BASE_DIR, '치킨_브랜드_TOP60.csv'), 'r', encoding='utf-8-sig') as f:
    reader = csv.reader(f)
    next(reader)
    for row in reader:
        if row and row[0].strip():
            chicken_brands.append(row[0].strip())

brand_patterns = []
seen = set()

def add_pattern(pat, brand):
    pat = normalize(pat)
    if len(pat) >= 2 and pat not in seen:
        seen.add(pat)
        brand_patterns.append((pat, brand))

for brand in chicken_brands:
    m = re.search(r'\(([^)]+)\)', brand)
    if m:
        alias = m.group(1)
        main = re.sub(r'\s*\([^)]+\)\s*', '', brand).strip()
        add_pattern(main, brand)
        add_pattern(alias, brand)
        base = main
    else:
        add_pattern(brand, brand)
        base = brand
    nb = normalize(base)
    for suffix in CHICKEN_SUFFIXES:
        if nb.endswith(suffix) and len(nb) - len(suffix) >= 3:
            add_pattern(nb[:-len(suffix)], brand)
            break

# 후보 데이터 로드
rows = []
with open(os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv'), 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows.append(row)

# 치킨 프랜차이즈 매칭
chicken_stores = []
remaining = []
for row in rows:
    nk = normalize(row.get('이름키', ''))
    sn = normalize(row.get('가맹점명', ''))
    is_chicken = any(pat in nk or pat in sn for pat, _ in brand_patterns)
    if is_chicken:
        chicken_stores.append(row)
    else:
        remaining.append(row)

print(f"1단계: 치킨 프랜차이즈 {len(chicken_stores)}건 제외, 남은 {len(remaining)}건")


# ═══════════════════════════════════════════════════════════
# 2단계: 네이버 검색으로 영업시간 수집
# ═══════════════════════════════════════════════════════════

BAR_TYPES = {'정종/대포집/소주방', '라이브카페'}

bars_confirmed = []      # 업태상 주점 확정 (검색 불필요)
need_search = []         # 검색 필요

for row in remaining:
    if row.get('공식_업태명', '') in BAR_TYPES:
        bars_confirmed.append(row)
    else:
        need_search.append(row)

print(f"  업태상 주점 확정: {len(bars_confirmed)}건")
print(f"  네이버 검색 대상: {len(need_search)}건")


def fetch_naver_hours(store_name, addr_hint=''):
    """네이버 검색에서 시간 패턴 추출"""
    query = f"{store_name} {addr_hint} 영업시간" if addr_hint else f"{store_name} 영업시간"
    url = "https://search.naver.com/search.naver?" + urllib.parse.urlencode(
        {'query': query}, encoding='utf-8')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        return []

    # "HH:MM-HH:MM" 또는 "HH:MM-HH:MM" 패턴 추출
    patterns = re.findall(
        r'(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})', html
    )
    # 중복 제거, 순서 유지
    seen_pairs = set()
    result = []
    for open_t, close_t in patterns:
        key = (open_t, close_t)
        if key not in seen_pairs:
            seen_pairs.add(key)
            result.append((open_t, close_t))
    return result


def is_open_after_20(time_pairs):
    """
    시간 패턴에서 오후 8시(20:00) 이후 영업 여부 판단.
    브레이크 타임(14:00~17:00 영역)은 제외.
    반환: True(8시 이후 영업), False(8시 이전 마감), None(판단 불가)
    """
    candidates = []  # (open_minutes, close_minutes)

    for open_t, close_t in time_pairs:
        om = re.match(r'(\d{1,2}):(\d{2})', open_t)
        cm = re.match(r'(\d{1,2}):(\d{2})', close_t)
        if not om or not cm:
            continue

        oh, omm = int(om.group(1)), int(om.group(2))
        ch_, cmm = int(cm.group(1)), int(cm.group(2))
        open_total = oh * 60 + omm
        close_total = ch_ * 60 + cmm

        # 24:00 → 자정(0분)
        if ch_ == 24:
            close_total = 0

        # 브레이크 타임 제외: 오픈 14:00~17:00, 마감 15:00~18:00
        if 840 <= open_total <= 1020 and 900 <= close_total <= 1080:
            continue

        candidates.append((open_total, close_total))

    if not candidates:
        return None

    for open_t, close_t in candidates:
        # 마감이 오픈보다 빠르거나 같으면 새벽(다음 날) 마감 → 8시 이후 영업
        if close_t <= open_t:
            return True
        # 마감이 20:00(1200분) 이후 → 8시 이후 영업
        if close_t > 1200:
            return True

    # 모든 후보가 20:00 이전 마감
    return False


# 검색 수행
search_results = {}  # store_name → (time_pairs, is_open_after_20)

for i, row in enumerate(need_search):
    name = row['가맹점명']
    addr_hint = '춘천' if '춘천' in row.get('소재지도로명주소', '') else ''
    pairs = fetch_naver_hours(name, addr_hint)
    verdict = is_open_after_20(pairs)
    search_results[name] = (pairs, verdict)

    if (i + 1) % 10 == 0 or i == len(need_search) - 1:
        print(f"  검색 진행: {i+1}/{len(need_search)}")
    time.sleep(0.3)


# ═══════════════════════════════════════════════════════════
# 3단계: 최종 분류
# ═══════════════════════════════════════════════════════════

not_bars = []   # 비주점 (검토완료 대상)
bars = []       # 주점 (검토후보 유지 대상)

# 1단계 치킨 프랜차이즈 → 비주점
not_bars.extend(chicken_stores)

# 업태상 주점 → 주점
bars.extend(bars_confirmed)

# 검색 결과 분류
search_not_bars = []
search_bars = []
no_data = []

for row in need_search:
    name = row['가맹점명']
    pairs, verdict = search_results.get(name, ([], None))

    if verdict is False:
        # 8시 이전 마감 → 비주점
        search_not_bars.append(row)
    elif verdict is True:
        # 8시 이후 영업 → 주점
        search_bars.append(row)
    else:
        # 판단 불가 → 일단 주점으로 유지 (보수적 접근)
        no_data.append(row)
        search_bars.append(row)

not_bars.extend(search_not_bars)
bars.extend(search_bars)


# ═══════════════════════════════════════════════════════════
# 결과 출력
# ═══════════════════════════════════════════════════════════

print(f"\n{'='*60}")
print(f"최종 분류 결과")
print(f"{'='*60}")
print(f"비주점 (검토완료): {len(not_bars)}건")
print(f"  - 치킨 프랜차이즈: {len(chicken_stores)}건")
print(f"  - 8시 이전 마감:  {len(search_not_bars)}건")
print(f"주점 (검토후보):   {len(bars)}건")
print(f"  - 업태상 주점:     {len(bars_confirmed)}건")
print(f"  - 8시 이후 영업:  {len(search_bars) - len(no_data)}건")
print(f"  - 판단불가(주점유지): {len(no_data)}건")

print(f"\n--- 8시 이전 마감 (비주점) ---")
for row in search_not_bars:
    name = row['가맹점명']
    pairs, _ = search_results.get(name, ([], None))
    pairs_str = ', '.join(f"{o}-{c}" for o, c in pairs[:2])
    print(f"  ★ {name} | {pairs_str}")

print(f"\n--- 판단 불가 (주점으로 유지) ---")
for row in no_data:
    name = row['가맹점명']
    pairs, _ = search_results.get(name, ([], None))
    pairs_str = ', '.join(f"{o}-{c}" for o, c in pairs[:2]) if pairs else '정보 없음'
    print(f"  ? {name} | {pairs_str}")


# ═══════════════════════════════════════════════════════════
# 4단계: 파일 저장
# ═══════════════════════════════════════════════════════════

# 비주점 → 주점관련_검토완료.csv
done_path = os.path.join(BASE_DIR, '주점관련_검토완료.csv')
with open(done_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(not_bars)
print(f"\n저장: {done_path} ({len(not_bars)}건)")

# 주점 → A_주점관련_검토후보.csv (덮어쓰기)
candidate_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
with open(candidate_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(bars)
print(f"저장: {candidate_path} ({len(bars)}건)")

print(f"\n완료!")
