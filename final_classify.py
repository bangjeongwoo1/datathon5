# -*- coding: utf-8 -*-
# -*- coding: utf-8 -*-
"""
hours_result.json의 원본 영업시간 데이터에 수정된 분류 로직을 적용하여
최종 CSV 파일을 생성한다.

로직:
  - 마감시간이 오픈시간보다 빠르거나 같으면 새벽(다음 날) 마감 → 8시 이후 영업
  - 마감시간이 20:00 초과 → 8시 이후 영업
  - 브레이크 타임(14:00~17:00 영역)은 제외
  - 두 실행 결과를 합산하여 보수적으로 판단 (어느 한쪽이라도 8시 이전 마감이면 비주점)
"""
import csv
import re
import os
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def normalize(s):
    s = s.lower()
    s = re.sub(r'[\s\-_·ㆍ&(),.\[\]/]', '', s)
    return s


# ═══════════════════════════════════════════════════════════
# 1단계: 치킨 프랜차이즈 매칭 (classify_stores.py와 동일)
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

# 원본 데이터 복원: 두 출력 파일을 합쳐서 197건 복구
fieldnames = None
rows = []
candidate_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
done_path_check = os.path.join(BASE_DIR, '주점관련_검토완료.csv')

for fpath in [candidate_path, done_path_check]:
    if os.path.exists(fpath):
        with open(fpath, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            if fieldnames is None:
                fieldnames = reader.fieldnames
            for row in reader:
                rows.append(row)

# 중복 제거 (가맹점ID 기준)
seen_ids = set()
unique_rows = []
for row in rows:
    gid = row.get('가맹점ID', '')
    if gid not in seen_ids:
        seen_ids.add(gid)
        unique_rows.append(row)
rows = unique_rows

print(f"총 후보 업소: {len(rows)}건")

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

print(f"치킨 프랜차이즈: {len(chicken_stores)}건")


# ═══════════════════════════════════════════════════════════
# 2단계: hours_result.json 기반 영업시간 분류
# ═══════════════════════════════════════════════════════════

BAR_TYPES = {'정종/대포집/소주방', '라이브카페'}

# JSON 로드
json_path = os.path.join(BASE_DIR, 'hours_result.json')
with open(json_path, 'r', encoding='utf-8') as f:
    json_data = json.load(f)

# store_name → raw hours 리스트 매핑
hours_map = {}
for r in json_data.get('all_results', []):
    hours_map[r['name']] = r.get('hours', [])


def parse_time_pair(pair_str):
    """'HH:MM-HH:MM' → (open_minutes, close_minutes, is_2400) 또는 None"""
    m = re.match(r'(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})', pair_str)
    if not m:
        return None
    oh, omm = int(m.group(1)), int(m.group(2))
    ch_, cmm = int(m.group(3)), int(m.group(4))
    open_t = oh * 60 + omm
    close_t = ch_ * 60 + cmm
    is_2400 = (ch_ == 24)
    if is_2400:
        close_t = 0
    return (open_t, close_t, is_2400)

def is_open_after_midnight(hours_list):
    """
    시간 패턴 목록에서 밤 12시(24:00) 이후 영업 여부 판단.
    - 자정 이후까지 영업(예: 17:00-01:00, 18:00-02:00) → True
    - 24시간 영업(00:00-24:00, 오픈=마감) → True
    - 24:00 또는 00:00 마감은 '자정 마감'이므로 12시 이후 영업이 아님 → False
    - 브레이크 타임(14:00~17:00 영역)은 제외
    반환: True(자정 이후 영업), False(자정 이전 마감), None(판단 불가)
    """
    candidates = []  # (open_t, close_t, is_2400)

    for pair_str in hours_list:
        parsed = parse_time_pair(pair_str)
        if not parsed:
            continue
        open_t, close_t, is_2400 = parsed

        # 브레이크 타임 제외: 오픈 14:00~17:00, 마감 15:00~18:00
        if 840 <= open_t <= 1020 and 900 <= close_t <= 1080:
            continue

        candidates.append((open_t, close_t, is_2400))

    if not candidates:
        return None

    for open_t, close_t, is_2400 in candidates:
        if is_2400:
            # 00:00-24:00 → 24시간 영업
            if open_t == 0:
                return True
            continue  # 그 외 24:00 마감은 자정 마감
        if close_t == open_t:
            return True  # 오픈=마감 → 24시간 영업으로 간주
        if close_t < open_t and close_t > 0:
            return True  # 01:00, 02:00 등 새벽 마감

    return False


# 분류 실행
bars_confirmed = []
need_search_rows = []
for row in remaining:
    if row.get('공식_업태명', '') in BAR_TYPES:
        bars_confirmed.append(row)
    else:
        need_search_rows.append(row)

search_not_bars = []
search_bars = []
no_data = []

for row in need_search_rows:
    name = row['가맹점명']
    hours = hours_map.get(name, [])
    verdict = is_open_after_midnight(hours)

    if verdict is False:
        search_not_bars.append(row)
    elif verdict is True:
        search_bars.append(row)
    else:
        no_data.append(row)
        search_bars.append(row)  # 보수적: 판단 불가 시 주점 유지


# ═══════════════════════════════════════════════════════════
# 최종 분류
# ═══════════════════════════════════════════════════════════

not_bars = list(chicken_stores) + search_not_bars
bars = list(bars_confirmed) + search_bars

print(f"\n{'='*60}")
print(f"최종 분류 결과")
print(f"{'='*60}")
print(f"비주점 (검토완료): {len(not_bars)}건")
print(f"  - 치킨 프랜차이즈: {len(chicken_stores)}건")
print(f"  - 8시 이전 마감:  {len(search_not_bars)}건")
print(f"주점 (검토후보):   {len(bars)}건")
print(f"  - 업태상 주점:     {len(bars_confirmed)}건")
print(f"  - 12시 이후 영업:  {len(search_bars) - len(no_data)}건")
print(f"  - 판단불가(주점유지): {len(no_data)}건")

print(f"\n--- 12시 이전 마감 (비주점) ---")
for row in search_not_bars:
    name = row['가맹점명']
    hours = hours_map.get(name, [])
    pairs_str = ', '.join(hours[:3])
    print(f"  ★ {name} | {pairs_str}")

print(f"\n--- 판단 불가 ---")
for row in no_data:
    name = row['가맹점명']
    hours = hours_map.get(name, [])
    print(f"  ? {name} | {', '.join(hours[:3]) if hours else '정보 없음'}")


# ═══════════════════════════════════════════════════════════
# 파일 저장
# ═══════════════════════════════════════════════════════════

# 비주점 → 주점관련_검토완료.csv
done_path = os.path.join(BASE_DIR, '주점관련_검토완료.csv')
with open(done_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(not_bars)
print(f"\n저장: 주점관련_검토완료.csv ({len(not_bars)}건)")

# 주점 → A_주점관련_검토후보.csv (덮어쓰기)
candidate_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
with open(candidate_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(bars)
print(f"저장: A_주점관련_검토후보.csv ({len(bars)}건)")
print(f"원본 백업: A_주점관련_검토후보_원본.csv")
print(f"\n완료! 총 {len(not_bars) + len(bars)}건 (원본 {len(rows)}건)")
