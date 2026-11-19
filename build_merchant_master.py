# -*- coding: utf-8 -*-
"""
강릉시.csv / 원주시.csv / 춘천시.csv / 홍천군.csv (중복·업종기타 처리가 끝난
4개 지역 CSV, 이 스크립트와 같은 폴더에 위치)를 하나로 합치고, 네이버 지도에서
업종(주점/비주점 판별용)과 요일별 영업시간을 1회 방문으로 수집해 채운다.

처리 내용:
  1. 4개 CSV 병합 (컬럼 구성은 사전에 23개 전부 동일함을 확인함)
  2. 업소마다 네이버를 1회 방문해 업종을 수집하고 "Cuisine" 컬럼에 기록.
     주점/비주점 판별은 naver_category.judge_by_category()를 그대로 재사용
     (요청하신 "기존 로직 똑같이" 반영) → "네이버기반판별" 컬럼에 기록.
  3. 기존에 이미 있던 8개 영업시간 컬럼(weekdayOperOpenHhmm 등)을, 네이버에서
     찾은 값으로 채움. 평일(월~금)은 서로 다르면 최빈값을 사용. 네이버에서
     못 찾은 값은 원본 값을 그대로 둔다(지움/덮어쓰지 않음).
     배달시간은 "배달" 키워드 주변 시간대를 찾는 최선 노력(beat-effort) 방식이라
     다른 항목보다 신뢰도가 낮음 - 샘플 테스트에서 특히 확인 필요.
  4. merchant_id 컬럼을 새로 만들어 병합된 순서대로 1부터 오름차순 부여.

재사용(중복 구현 없음): make_driver(make_hours_csv.py), judge_by_category(naver_category.py).
크롤링 자체(펼쳐보기 클릭, 요일별 영업시간 파싱)는 이 파일에서 새로 작성.

TEST_SAMPLE_PER_FILE: 지역별로 몇 개를 무작위로 뽑아 테스트할지. 0이면 전체 실행.
"""
import csv, os, random, re, time, urllib.parse

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from make_hours_csv import make_driver
from naver_category import judge_by_category

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = BASE_DIR  # 이 브랜치에서는 4개 지역 CSV가 스크립트와 같은 폴더에 있음

SOURCE_FILES = ['강릉시.csv', '원주시.csv', '춘천시.csv', '홍천군.csv']

HOUR_COLUMNS = [
    'weekdayOperOpenHhmm', 'weekdayOperColseHhmm',
    'satOperOperOpenHhmm', 'satOperCloseHhmm',
    'holidayOperOpenHhmm', 'holidayCloseOpenHhmm',
    'dlvrOperOpenHhmm', 'dlvrCloseOpenHhmm',
]

WEEKDAY_DAYS = {'월', '화', '수', '목', '금'}
SATURDAY_DAYS = {'토'}
SUNDAY_DAYS = {'일', '일요일', '공휴일'}

TEST_SAMPLE_PER_FILE = 5  # 지역별 샘플 개수. 전체 실행하려면 0으로.
RANDOM_SEED = 1120202602  # 이전 샘플(10개/지역)과 겹치지 않도록 새 시드로 변경


# ── 1. 병합 ──────────────────────────────────────────────
def load_and_merge():
    merged = []
    fieldnames = None
    for fname in SOURCE_FILES:
        path = os.path.join(SRC_DIR, fname)
        with open(path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            if fieldnames is None:
                fieldnames = reader.fieldnames
            elif reader.fieldnames != fieldnames:
                raise ValueError(
                    f"{fname}의 컬럼이 기준({SOURCE_FILES[0]})과 다릅니다: {reader.fieldnames}"
                )
            rows = list(reader)
        print(f"{fname}: {len(rows)}건")
        merged.extend(rows)
    return fieldnames, merged


# ── 2~3. 네이버 업종 + 요일별 영업시간 수집 ───────────────
def road_token_from_address(addr):
    """전체 주소 문자열에서 '도로명 + 건물번호'만 추출 (검색어 정확도용)."""
    if not addr:
        return ''
    m = re.search(r'([가-힣0-9]+(?:로|길))\s*(\d+(?:-\d+)?)', addr)
    return f"{m.group(1)} {m.group(2)}" if m else ''


def mode_pair(pairs):
    """(open,close) 튜플 목록 중 가장 자주 등장한 값. 동률이면 첫 번째."""
    if not pairs:
        return '', ''
    counts = {}
    order = []
    for p in pairs:
        if p not in counts:
            order.append(p)
        counts[p] = counts.get(p, 0) + 1
    best = max(order, key=lambda p: counts[p])
    return best


def extract_day_hours(raw_text):
    """요일 라벨이 붙은 'HH:MM - [다음 날] HH:MM' 패턴을 평일/토/일로 분류."""
    pairs = re.findall(
        r'(월|화|수|목|금|토|일|매일|공휴일)\s*\n\s*(\d{1,2}:\d{2})\s*[-~]\s*(?:다음\s*날\s*)?(\d{1,2}:\d{2})',
        raw_text,
    )
    buckets = {'weekday': [], 'saturday': [], 'sunday': []}
    for day, o, c in pairs:
        if day == '매일':
            buckets['weekday'].append((o, c))
            buckets['saturday'].append((o, c))
            buckets['sunday'].append((o, c))
        elif day in WEEKDAY_DAYS:
            buckets['weekday'].append((o, c))
        elif day in SATURDAY_DAYS:
            buckets['saturday'].append((o, c))
        elif day in SUNDAY_DAYS:
            buckets['sunday'].append((o, c))
    return {
        'weekday': mode_pair(buckets['weekday']),
        'saturday': mode_pair(buckets['saturday']),
        'sunday': mode_pair(buckets['sunday']),
    }


def extract_delivery_hours(raw_text):
    """'배달' 근처의 시간대를 찾는 최선 노력 방식 - 다른 항목보다 신뢰도 낮음."""
    m = re.search(r'배달[\s\S]{0,10}?(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})', raw_text)
    if m:
        return m.group(1), m.group(2)
    return '', ''


def _extract_from_entry_iframe(driver, query_hint):
    """
    현재 페이지에 entryIframe이 존재한다고 가정하고 진입해 업종(span.mwWcl)과
    영업시간 원본 텍스트를 추출한다. fetch_once와 주소검색 폴백이 공유하는 로직.
    반환: dict(category, hours_raw, addr_check, status)
    """
    try:
        WebDriverWait(driver, 7).until(EC.frame_to_be_available_and_switch_to_it(
            (By.CSS_SELECTOR, 'iframe#entryIframe')
        ))

        category = ''
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'span.mwWcl'))
            )
            category = el.text.strip()
        except Exception:
            category = ''

        try:
            blind = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.XPATH,
                    '//*[contains(@class,"place_blind") and contains(text(),"펼쳐보기")]'))
            )
            clickable = blind.find_element(By.XPATH, '..')
            driver.execute_script("arguments[0].click();", clickable)
            try:
                WebDriverWait(driver, 4).until(
                    lambda d: '접기' in d.find_element(By.TAG_NAME, 'body').text
                )
            except Exception:
                time.sleep(1.5)
        except Exception:
            pass

        body = ''
        for _ in range(2):
            body = driver.find_element(By.TAG_NAME, 'body').text
            if category or re.search(r'\d{1,2}:\d{2}', body) or '영업시간 정보 수정' in body:
                break
            time.sleep(0.5)
            if not category:
                try:
                    category = driver.find_element(By.CSS_SELECTOR, 'span.mwWcl').text.strip()
                except Exception:
                    pass

        if not category:
            m_cat = re.search(r'\n([가-힣]{2,10}(?:,[가-힣]{2,10})?)\n', body) if body else None
            if m_cat:
                category = m_cat.group(1).strip()

        hours_raw = ''
        m = re.search(r'영업시간\s*([\s\S]{0,800}?)(?:접기|영업시간 수정)', body)
        if m:
            hours_raw = m.group(0)[:800]
        else:
            m2 = re.search(r'영업\s*(?:종료|중|전).{0,200}', body)
            if m2:
                hours_raw = m2.group(0)[:200]

        driver.switch_to.default_content()

        addr_check = ''
        if category:
            addr_check = 'match' if (query_hint and query_hint.split(' ')[0] in body) else 'unverified'

        status = 'ok' if category else 'no_category'
        return {'category': category, 'hours_raw': hours_raw, 'addr_check': addr_check, 'status': status}

    except Exception as e:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:{type(e).__name__}'}


def fetch_once(driver, name, query_hint):
    """업소명(+도로명 힌트)으로 검색해서 entryIframe이 바로 열리는 경우를 처리."""
    query = f"{name} {query_hint}".strip() if query_hint else name
    url = f"https://map.naver.com/v5/search/{urllib.parse.quote(query)}"

    try:
        driver.get(url)
        time.sleep(3)
    except Exception as e:
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:load:{type(e).__name__}'}

    try:
        iframes = driver.find_elements(By.TAG_NAME, 'iframe')
        ids = [f.get_attribute('id') or '' for f in iframes]
    except Exception as e:
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:iframe_list:{type(e).__name__}'}

    if 'entryIframe' not in ids:
        # 업소명이 흔해서(편의점 체인 등) 네이버가 바로 한 곳을 열지 않고
        # 검색결과 목록(searchIframe)부터 보여주는 경우가 많음 - 거기서
        # 업소명과 일치하는 항목을 찾아 클릭해 상세 페이지를 연다.
        if 'searchIframe' in ids and _try_search_iframe_match(driver, name):
            try:
                iframes2 = driver.find_elements(By.TAG_NAME, 'iframe')
                ids2 = [f.get_attribute('id') or '' for f in iframes2]
            except Exception as e:
                return {'category': '', 'hours_raw': '', 'addr_check': '',
                        'status': f'error:iframe_list2:{type(e).__name__}'}
            if 'entryIframe' in ids2:
                return _extract_from_entry_iframe(driver, query_hint)
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': 'not_found'}

    return _extract_from_entry_iframe(driver, query_hint)


def _normalize_name(s):
    return re.sub(r'[\s\-_·()]', '', s or '').lower()


def _try_search_iframe_match(driver, target_name):
    """
    searchIframe(검색결과 목록) 안에서 업소명과 일치하는 항목(li.VLTHu)을 찾아
    이름 링크를 클릭해 상세 페이지(entryIframe)를 연다. 실사용 확인 결과,
    목록 항목에는 업종/영업상태 미리보기도 있지만 요일별 영업시간까지는
    없어서, 클릭해서 기존 _extract_from_entry_iframe로 상세까지 들어간다.
    반환: 클릭 성공 여부 (bool)
    """
    target_norm = _normalize_name(target_name)
    try:
        driver.switch_to.frame('searchIframe')
        try:
            # 검색결과 목록은 iframe 자체보다 늦게 채워지는 경우가 있어 명시적으로 대기
            WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'li.VLTHu'))
            )
        except Exception:
            pass
        items = driver.find_elements(By.CSS_SELECTOR, 'li.VLTHu')
        clicked = False
        for li in items[:10]:
            first_line = (li.text or '').split('\n')[0].strip()
            norm = _normalize_name(first_line)
            if not norm or not (norm == target_norm or target_norm in norm or norm in target_norm):
                continue
            anchors = li.find_elements(By.CSS_SELECTOR, 'a')
            if not anchors:
                continue
            # 이름이 적힌 링크를 우선 사용하되, 못 찾으면 첫 번째 링크로 대체
            link = next(
                (a for a in anchors if (a.text or '').strip().split('\n')[0] == first_line),
                anchors[0],
            )
            try:
                driver.execute_script("arguments[0].click();", link)
                clicked = True
                # entryIframe 전환 대기는 호출부(_extract_from_entry_iframe)의
                # WebDriverWait(7)가 이미 담당하므로 여기선 최소한만 대기
                time.sleep(1.0)
                break
            except Exception:
                continue
        driver.switch_to.default_content()
        return clicked
    except Exception:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return False


def _result_suspicious(info):
    # not_found는 여기서 재시도하지 않음 (searchIframe 타이밍 문제는
    # _try_search_iframe_match의 WebDriverWait로 이미 대응함. 같은 업소명
    # 검색을 반복해봐야 결과가 바뀔 가능성은 낮으므로 불필요한 재시도로
    # 시간만 늘리지 않음).
    cat_sus = bool(re.match(r'^영업\s*(?:전|중|종료)', info['category'] or ''))
    raw = info['hours_raw']
    hrs_sus = False
    if raw and not raw.startswith('[ERR'):
        m = re.match(r'^영업\s*(?:전|중|종료)', raw)
        hrs_sus = bool(m and not re.match(r'\s*\d', raw[m.end():]))
    return cat_sus or hrs_sus


def fetch(driver, name, query_hint, max_attempts=2):
    """업소명+도로명 힌트로 검색한다. 주소 재검색 폴백은 업체 1건당 추가로
    네이버를 한 번 더 방문해야 해서 전체 수집 시간이 크게 늘어나므로 제거함."""
    info = {'category': '', 'hours_raw': '', 'addr_check': '', 'status': 'not_found'}
    for attempt in range(max_attempts):
        info = fetch_once(driver, name, query_hint)
        if not _result_suspicious(info):
            return info
        if attempt < max_attempts - 1:
            time.sleep(1.5)
    return info


def main():
    fieldnames, rows = load_and_merge()
    print(f"\n병합 완료: {len(rows)}건 (컬럼 {len(fieldnames)}개, 전부 동일)")

    random.seed(RANDOM_SEED)
    if TEST_SAMPLE_PER_FILE:
        # 이전 검증에 썼던 업소(업소명+주소 기준)는 이번 샘플 풀에서 제외
        prev_path = os.path.join(BASE_DIR, '가맹점_마스터_샘플10_이전.csv')
        prev_keys = set()
        if os.path.exists(prev_path):
            with open(prev_path, 'r', encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    prev_keys.add((r.get('mrhstNm', ''), r.get('rdnmadr', '')))
            print(f"이전 샘플 제외 대상: {len(prev_keys)}건")

        # 지역별로 원래 속했던 파일을 기억해 각 파일에서 균등하게 샘플링
        by_source = {}
        idx = 0
        for fname in SOURCE_FILES:
            path = os.path.join(SRC_DIR, fname)
            with open(path, 'r', encoding='utf-8-sig') as f:
                n = sum(1 for _ in csv.DictReader(f))
            by_source[fname] = rows[idx:idx + n]
            idx += n

        target_rows = []
        for fname in SOURCE_FILES:
            pool = [r for r in by_source[fname] if (r.get('mrhstNm', ''), r.get('rdnmadr', '')) not in prev_keys]
            sample = random.sample(pool, min(TEST_SAMPLE_PER_FILE, len(pool)))
            target_rows.extend(sample)
        print(f"테스트 샘플: 지역별 {TEST_SAMPLE_PER_FILE}개씩(이전 샘플 제외), 총 {len(target_rows)}건")
    else:
        target_rows = rows

    # 네이버기반판별/주소확인/수집상태는 3개 파일로 분리되는 순간
    # 파일명 자체가 그 정보를 담으므로 저장 컬럼에는 넣지 않음(내부 처리/로그용으로만 사용)
    out_fieldnames = ['merchant_id'] + fieldnames + ['Cuisine']

    print("Edge 드라이버 초기화 중...")
    driver = make_driver()
    print("시작. Edge 창이 열립니다.")

    results = []
    try:
        for i, row in enumerate(target_rows):
            name = row.get('mrhstNm', '')
            address = row.get('rdnmadr', '')
            road_hint = road_token_from_address(address) or row.get('signguNm', '')

            try:
                info = fetch(driver, name, road_hint)
            except Exception as e:
                info = {'category': '', 'hours_raw': '', 'addr_check': '',
                         'status': f'error:unexpected:{type(e).__name__}'}

            verdict = judge_by_category(info['category']) if info['status'] == 'ok' else '판별불가'
            day_hours = extract_day_hours(info['hours_raw']) if info['hours_raw'] else \
                {'weekday': ('', ''), 'saturday': ('', ''), 'sunday': ('', '')}
            dlvr_open, dlvr_close = extract_delivery_hours(info['hours_raw']) if info['hours_raw'] else ('', '')

            out_row = dict(row)
            out_row['Cuisine'] = info['category']
            out_row['네이버기반판별'] = verdict
            out_row['주소확인'] = info['addr_check']
            out_row['수집상태'] = info['status']

            # 네이버에서 찾은 값이 있을 때만 덮어쓰고, 못 찾으면 원본 값 유지
            wd_o, wd_c = day_hours['weekday']
            sa_o, sa_c = day_hours['saturday']
            su_o, su_c = day_hours['sunday']
            if wd_o: out_row['weekdayOperOpenHhmm'] = wd_o
            if wd_c: out_row['weekdayOperColseHhmm'] = wd_c
            if sa_o: out_row['satOperOperOpenHhmm'] = sa_o
            if sa_c: out_row['satOperCloseHhmm'] = sa_c
            if su_o: out_row['holidayOperOpenHhmm'] = su_o
            if su_c: out_row['holidayCloseOpenHhmm'] = su_c
            if dlvr_open: out_row['dlvrOperOpenHhmm'] = dlvr_open
            if dlvr_close: out_row['dlvrCloseOpenHhmm'] = dlvr_close

            results.append(out_row)

            hrs_display = f"평일{wd_o or '-'}~{wd_c or '-'} 토{sa_o or '-'}~{sa_c or '-'} 일{su_o or '-'}~{su_c or '-'}"
            print(f"  [{i+1}/{len(target_rows)}] {name[:18]:18s} -> {verdict:6s} | "
                  f"Cuisine:{info['category'] or '(없음)':10s} | {hrs_display}")
            time.sleep(0.5)

    finally:
        driver.quit()

    # merchant_id는 병합 순서(= 결과 저장 순서) 기준 1부터 오름차순
    for i, row in enumerate(results, start=1):
        row['merchant_id'] = i

    # 네이버기반판별 기준으로 3개 파일 분리: 주점의심 -> 주점.csv,
    # 정상 -> 비주점.csv, 판별불가 -> 검수필요.csv
    suffix = f'_샘플{TEST_SAMPLE_PER_FILE}' if TEST_SAMPLE_PER_FILE else ''
    buckets = {
        '주점의심': f'주점{suffix}.csv',
        '정상': f'비주점{suffix}.csv',
        '판별불가': f'검수필요{suffix}.csv',
    }
    grouped = {verdict: [] for verdict in buckets}
    for row in results:
        grouped.setdefault(row['네이버기반판별'], []).append(row)

    print(f"\n저장 완료:")
    for verdict, fname in buckets.items():
        rows_for_verdict = grouped.get(verdict, [])
        out_path = os.path.join(BASE_DIR, fname)
        with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
            # out_row에는 내부 처리용 컬럼(네이버기반판별 등)도 같이 들어있으므로
            # extrasaction='ignore'로 저장 컬럼(out_fieldnames)만 골라서 씀
            writer = csv.DictWriter(f, fieldnames=out_fieldnames, extrasaction='ignore')
            writer.writeheader()
            writer.writerows(rows_for_verdict)
        print(f"  {fname} ({len(rows_for_verdict)}건)")

    ok = sum(1 for r in results if r['네이버기반판별'] != '판별불가')
    print(f"  업종 판별 성공(판별불가 아님): {ok}건 / {len(results)}건")


if __name__ == '__main__':
    main()
