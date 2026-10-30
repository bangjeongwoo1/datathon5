# -*- coding: utf-8 -*-
"""
A_주점관련_검토후보.csv의 매장들을 네이버 검색으로 영업시간 확인 후:
  - 밤 12시(24:00) 넘어서까지 영업 → 검토후보 유지
  - 밤 12시 이전 종료 → 중복의심_검토_완료.csv로 이동
"""
import csv
import re
import os
import urllib.request
import urllib.parse
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def fetch_naver_hours(store_name, addr_hint=''):
    """네이버 검색에서 HH:MM-HH:MM 패턴 추출"""
    query = f"{store_name} {addr_hint} 영업시간" if addr_hint else f"{store_name} 영업시간"
    url = "https://search.naver.com/search.naver?" + urllib.parse.urlencode(
        {'query': query}, encoding='utf-8')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except Exception:
        return []

    # HH:MM-HH:MM 패턴 추출 (중복 제거, 순서 유지)
    pairs = re.findall(r'(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})', html)
    seen = set()
    result = []
    for o, c in pairs:
        if (o, c) not in seen:
            seen.add((o, c))
            result.append((o, c))
    return result


def is_past_midnight(time_pairs):
    """
    시간 패턴에서 밤 12시(자정) 넘어서까지 영업하는지 판단.
    브레이크 타임(14:00~17:00) 제외.
    반환: True(자정 넘김), False(자정 전 종료), None(판단 불가)
    """
    candidates = []
    for open_t, close_t in time_pairs:
        om = re.match(r'(\d{1,2}):(\d{2})', open_t)
        cm = re.match(r'(\d{1,2}):(\d{2})', close_t)
        if not om or not cm:
            continue

        oh, omm = int(om.group(1)), int(om.group(2))
        ch_, cmm = int(cm.group(1)), int(cm.group(2))
        open_min = oh * 60 + omm
        # 24:00은 1440으로 처리 (자정)
        close_min = ch_ * 60 + cmm if ch_ != 24 else 1440

        # 브레이크 타임 제외: 오픈 14:00~17:00, 마감 15:00~18:00
        if 840 <= open_min <= 1020 and 900 <= close_min <= 1080:
            continue

        candidates.append((open_min, close_min))

    if not candidates:
        return None

    for open_min, close_min in candidates:
        # 마감이 오픈보다 빠르면 새벽(다음 날) 마감 → 자정 넘김
        if close_min < open_min:
            return True
        # 24:00(=1440)은 자정 정각 → 넘기지 않음 → not past midnight
        # 24:00 초과는 불가능 (최대 1440)

    # 모든 패턴이 자정 전 종료
    return False


# ── 데이터 로드 ──────────────────────────────────────
bar_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
done_path = os.path.join(BASE_DIR, '중복의심_검토_완료.csv')

with open(bar_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    bar_fieldnames = reader.fieldnames
    bar_rows = list(reader)

with open(done_path, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    done_fieldnames = reader.fieldnames
    done_rows = list(reader)

print(f"주점후보: {len(bar_rows)}행")
print(f"중복완료(기존): {len(done_rows)}행")

# 통합 컬럼 (합집합)
all_fieldnames = list(done_fieldnames)
for col in bar_fieldnames:
    if col not in all_fieldnames:
        all_fieldnames.append(col)


# ── Naver 검색 및 분류 ────────────────────────────────
keep_bars = []      # 자정 넘김 → 검토후보 유지
move_to_done = []   # 자정 전 종료 → 중복완료로 이동
no_data = []        # 판단 불가 → 검토후보 유지 (보수적)

for i, row in enumerate(bar_rows):
    name = row['가맹점명']
    addr_hint = '춘천' if '춘천' in row.get('소재지도로명주소', '') else ''
    pairs = fetch_naver_hours(name, addr_hint)
    verdict = is_past_midnight(pairs)

    if verdict is True:
        keep_bars.append(row)
    elif verdict is False:
        row['검토결과'] = '주점아님(자정전종료)'
        move_to_done.append(row)
    else:
        no_data.append(row)
        keep_bars.append(row)  # 보수적: 판단 불가 시 유지

    if (i + 1) % 20 == 0 or i == len(bar_rows) - 1:
        print(f"  진행: {i+1}/{len(bar_rows)}")

    time.sleep(0.3)


# ── 결과 출력 ────────────────────────────────────────
print(f"\n=== 분류 결과 ===")
print(f"자정 넘김 (검토후보 유지): {len(keep_bars) - len(no_data)}건")
print(f"판단불가 (검토후보 유지): {len(no_data)}건")
print(f"자정 전 종료 (중복완료로 이동): {len(move_to_done)}건")
print(f"검토후보 최종: {len(keep_bars)}행 (원본 {len(bar_rows)}행)")

if move_to_done:
    print(f"\n--- 자정 전 종료 매장 ---")
    for row in move_to_done:
        name = row['가맹점명']
        print(f"  ★ {name}")

if no_data:
    print(f"\n--- 영업시간 정보 없음 (주점 유지) ---")
    for row in no_data:
        print(f"  ? {row['가맹점명']}")


# ── 파일 저장 ────────────────────────────────────────
# 검토후보 (자정 넘김만)
with open(bar_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=bar_fieldnames)
    writer.writeheader()
    writer.writerows(keep_bars)
print(f"\n저장: A_주점관련_검토후보.csv ({len(keep_bars)}행)")

# 중복완료 (기존 + 이동)
combined = done_rows + move_to_done
with open(done_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=all_fieldnames)
    writer.writeheader()
    for row in combined:
        # 누락 컬럼 채우기
        full_row = {col: row.get(col, '') for col in all_fieldnames}
        writer.writerow(full_row)
print(f"저장: 중복의심_검토_완료.csv ({len(combined)}행 = 기존 {len(done_rows)} + 이동 {len(move_to_done)})")
