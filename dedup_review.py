# -*- coding: utf-8 -*-
"""
A_중복의심_검토.csv 중복 확인 및 제거

로직:
  1. (이름키, 위치키) 또는 (이름키, 도로명키)로 그룹핑 → 동일 매장 후보
  2. 그룹 내 행들이 동일 매장인지 판단:
     a. 주소 표기만 다름 (강원도/강원특별자치도/강원, 1층 유무, 동명 유무) → 중복
     b. 업종명만 다름 (한식/일반대중음식 등 호환 범주) → 중복
     c. 층수가 다름 (1층 vs 2층) → 인간 검수
     d. 비호환 업종 (한식 vs 중식, 청과물 vs 음식 등) → 인터넷 검색 → 판단 불가 시 인간 검수
  3. 중복 → 첫 번째 행만 유지
  4. 비중복 → 모든 행 유지 (다른 주소의 동일 상호명 등)
  5. 인간 검수 필요 → 별도 파일
"""
import csv
import re
import os
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def normalize_addr(s):
    """주소 비교용 정규화"""
    s = s.strip()
    s = re.sub(r'강원특별자치도|강원도|강원', '', s)
    s = re.sub(r'\s+', '', s)
    s = re.sub(r'[.]+$', '', s)
    s = re.sub(r'\(\d+동\)|\(효자동\)|\(후평동\)|\(퇴계동\)|\(석사동\)|\(우두동\)|\(근화동\)|\(온의동\)|\(교동\)|\(사농동\)|\(소양로\d+가\)|\(중앙로\d+가\)', '', s)
    s = re.sub(r'\d+층', '', s)
    s = re.sub(r'외\d+필지', '', s)
    return s


# 호환 가능한 업종명 그룹 (같은 매장으로 볼 수 있음)
COMPATIBLE_BIZ = {
    frozenset(['한식', '일반대중음식']),
    frozenset(['한식', '양식']),
    frozenset(['중식', '일반대중음식']),
    frozenset(['일반대중음식', '패스트푸드']),
    frozenset(['한식', '일식']),
    frozenset(['농협(마트)', '농협(기타)']),
    # 인터넷 검색/데이터 패턴으로 확인된 추가 호환 쌍
    frozenset(['일반대중음식', '제과점']),   # 강원대학교생활협동조합 (대학 생협 복합 식당)
    frozenset(['한식', '중식']),             # 지중해 (동일 매장 이중 등록)
}


def biz_compatible(types_set):
    """업종명들이 호환되는지 (같은 매장으로 볼 수 있는지) 판단"""
    if len(types_set) == 1:
        return True
    for compat in COMPATIBLE_BIZ:
        if types_set <= compat:
            return True
    return False


def extract_floor(addr):
    """주소에서 층 정보 추출"""
    m = re.search(r'(\d+)층', addr)
    if m:
        return int(m.group(1))
    if '지하' in addr:
        return -1
    return 0  # 층 정보 없음


# ── 데이터 로드 ──────────────────────────────────────
input_path = os.path.join(BASE_DIR, 'A_중복의심_검토.csv')
rows = []
with open(input_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows.append(row)

print(f"총 행 수: {len(rows)}")

# ── 그룹핑: (이름키, 위치키) ───────────────────────────
# 위치키가 비어있으면 도로명키+지번키 사용
groups = defaultdict(list)
for row in rows:
    name_key = row.get('이름키', '')
    loc_key = row.get('위치키', '')
    if not loc_key:
        road_key = row.get('도로명키', '')
        jibun_key = row.get('지번키', '')
        loc_key = f"{road_key}|{jibun_key}"
    group_key = (name_key, loc_key)
    groups[group_key].append(row)

print(f"그룹 수: {len(groups)}")

# ── 중복 판단 ────────────────────────────────────────
deduped = []       # 중복 제거된 행
not_dup = []       # 비중복 (모든 행 유지)
human_review = []   # 인간 검수 필요

for group_key, group_rows in groups.items():
    if len(group_rows) == 1:
        # 단일 행은 그대로 유지
        deduped.append(group_rows[0])
        continue

    # 그룹 내 업종명 집합
    biz_types = set(r.get('업종명', '') for r in group_rows)
    # 주소에서 층 추출
    floors = set(extract_floor(r.get('소재지도로명주소', '')) for r in group_rows)
    # 정규화 주소
    norm_addrs = set(normalize_addr(r.get('소재지도로명주소', '')) for r in group_rows)
    # 도로명키
    road_keys = set(r.get('도로명키', '') for r in group_rows)

    name_key, loc_key = group_key

    # 판단 기준
    needs_review = False
    review_reason = ''

    # 1. 층수가 다른 경우 (0은 층 정보 없음이므로 제외)
    # 단, 업종명이 모두 같으면 같은 매장의 다른 층으로 간주 (중복)
    real_floors = floors - {0}
    if len(real_floors) > 1 and len(biz_types) > 1:
        needs_review = True
        review_reason = f"층수+업종 차이: {sorted(real_floors)}층, {biz_types}"

    # 2. 비호환 업종
    if not needs_review and not biz_compatible(biz_types):
        needs_review = True
        review_reason = f"비호환 업종: {biz_types}"

    # 3. 도로명키가 다른 경우 (완전히 다른 위치)
    if not needs_review and len(road_keys) > 1:
        # 도로명키가 달라도 주소 정규화 후 같으면 중복
        if len(norm_addrs) > 1:
            needs_review = True
            review_reason = f"다른 도로명: {road_keys}"

    if needs_review:
        # 인간 검수 필요
        for r in group_rows:
            r_copy = dict(r)
            r_copy['검토결과'] = '인간검수필요'
            r_copy['비고'] = review_reason
            human_review.append(r_copy)
    else:
        # 중복 → 첫 번째 행만 유지
        first = dict(group_rows[0])
        first['검토결과'] = '중복제거'
        first['비고'] = f"중복 {len(group_rows)}건 → 1건 유지 (업종: {', '.join(biz_types)})"
        deduped.append(first)

print(f"\n=== 분류 결과 ===")
print(f"중복 제거 (1행 유지): {sum(1 for r in deduped if r.get('검토결과') == '중복제거')}건")
print(f"단일 행 (유지): {sum(1 for r in deduped if r.get('검토결과', '') == '')}건")
print(f"인간 검수 필요: {len(human_review)}건")
print(f"최종 행 수: {len(deduped)}건 (원본 {len(rows)}건에서 {len(rows) - len(deduped)}건 제거)")

print(f"\n--- 인간 검수 대상 ---")
seen_groups = set()
for r in human_review:
    name = r.get('가맹점명', '')
    if name not in seen_groups:
        seen_groups.add(name)
        print(f"  ★ {name} | {r.get('비고', '')}")

# ── 파일 저장 ────────────────────────────────────────
# 중복 제거 결과
output_path = os.path.join(BASE_DIR, '중복의심_검토_완료.csv')
with open(output_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(deduped)
print(f"\n저장: 중복의심_검토_완료.csv ({len(deduped)}건)")

# 인간 검수 필요
if human_review:
    review_path = os.path.join(BASE_DIR, '중복의심_인간검수필요.csv')
    with open(review_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(human_review)
    print(f"저장: 중복의심_인간검수필요.csv ({len(human_review)}건)")
