# -*- coding: utf-8 -*-
"""
주점관련_검토후보.csv 분류 스크립트
1단계: 치킨_브랜드_TOP60.csv 기반 프랜차이즈 치킨집 매칭
"""
import csv
import re
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def normalize(s):
    """매칭용 정규화: 소문자화, 공백/특수문자 제거"""
    s = s.lower()
    s = re.sub(r'[\s\-_·ㆍ&(),.\[\]/]', '', s)
    return s


# ── 1. 치킨 브랜드 로드 ──────────────────────────────────
chicken_brands = []
brand_path = os.path.join(BASE_DIR, '치킨_브랜드_TOP60.csv')
with open(brand_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.reader(f)
    header = next(reader)
    for row in reader:
        if row and row[0].strip():
            chicken_brands.append(row[0].strip())

# 치킨 관련 접미사 (긴 것부터 시도)
CHICKEN_SUFFIXES = [
    '숯불두마리치킨', '두마리치킨', '바베큐치킨',
    '양념치킨', '숯불치킨', '치킨', '통닭', '강정',
]

# 브랜드 패턴 추출 (괄호 안 별칭 + 접미사 제거 코어명 포함)
brand_patterns = []          # (정규화된 패턴, 원본 브랜드명)
seen_patterns = set()

def add_pattern(pat, brand):
    pat = normalize(pat)
    if len(pat) >= 2 and pat not in seen_patterns:
        seen_patterns.add(pat)
        brand_patterns.append((pat, brand))

for brand in chicken_brands:
    # 1) 괄호 안 별칭 분리
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

    # 2) 접미사 제거한 코어명 추가 (예: 지코바양념치킨 → 지코바)
    norm_base = normalize(base)
    for suffix in CHICKEN_SUFFIXES:
        if norm_base.endswith(suffix) and len(norm_base) - len(suffix) >= 3:
            core = norm_base[:-len(suffix)]
            add_pattern(core, brand)
            break  # 가장 긴 접미사 하나만 적용

print(f"치킨 브랜드 패턴 수: {len(brand_patterns)}")
for p, b in sorted(brand_patterns, key=lambda x: x[1]):
    print(f"  {b} -> '{p}'")


# ── 2. 후보 데이터 로드 ──────────────────────────────────
candidate_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
rows = []
with open(candidate_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows.append(row)

print(f"\n총 후보 업소 수: {len(rows)}")


# ── 3. 프랜차이즈 치킨집 매칭 ────────────────────────────
chicken_stores = []     # (row, matched_brand)
remaining = []

for row in rows:
    name_key = normalize(row.get('이름키', ''))
    store_name = normalize(row.get('가맹점명', ''))

    is_chicken = False
    matched_brand = None
    for pattern, brand in brand_patterns:
        if pattern in name_key or pattern in store_name:
            is_chicken = True
            matched_brand = brand
            break

    if is_chicken:
        chicken_stores.append((row, matched_brand))
    else:
        remaining.append(row)

print(f"\n=== 1단계: 프랜차이즈 치킨집 매칭 결과 ===")
print(f"치킨 프랜차이즈: {len(chicken_stores)}건")
print(f"남은 업소 (인터넷 검색 대상): {len(remaining)}건")

print(f"\n--- 치킨 프랜차이즈로 분류된 업소 ---")
for row, brand in chicken_stores:
    print(f"  [{brand}] {row['가맹점명']}")

print(f"\n--- 남은 업소 (인터넷 검색 대상) ---")
for i, row in enumerate(remaining, 1):
    clue = row.get('상호명_분류단서', '')
    biz_type = row.get('공식_업태명', '')
    print(f"  {i:3d}. {row['가맹점명']} | {biz_type} | 단서:{clue}")
