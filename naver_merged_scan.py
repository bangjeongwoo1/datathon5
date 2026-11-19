# -*- coding: utf-8 -*-
"""
A_주점관련_검토후보.csv의 업소를 네이버 지도에서 "한 번만" 방문해서
업종(span.mwWcl)과 영업시간을 동시에 수집한 뒤, 판별 결과에 따라
바로 두 개의 결과 파일로 나눈다.

왜 합쳤는가:
  naver_category.py(업종 판별)와 final_bar_dataset.py(영업시간)를 따로 돌리면
  같은 가게를 두 번 방문해야 해서 느리다. 이 스크립트는 entryIframe을 한 번만
  열어서 업종과 영업시간 원본 텍스트를 같이 긁고, 그 자리에서 판별까지 끝낸다.

흐름:
  1. A_주점관련_검토후보.csv(원본)를 읽는다.
  2. 업소마다 네이버 지도를 1회 방문 → 업종 + 영업시간 원본텍스트 동시 수집.
  3. 업종으로 주점의심 / 정상 / 판별불가 판별.
     - 주점의심 → 주점의심_업체목록.csv 로 분리 (영업시간 조회는 하지 않음,
       이미 열린 페이지에서 얻은 값이라도 이 파일에는 영업시간 컬럼이 없음)
     - 정상 / 판별불가 → parse_hours()로 여는/닫는시간을 채워
       비주점_업체목록.csv 로 분리.

재사용(중복 구현 없음): make_driver/parse_hours(make_hours_csv.py),
                        road_token/judge_by_category(naver_category.py).
크롤링 자체(펼쳐보기 클릭, 업종 추출, 재시도)는 이 파일에서 통합해 새로 작성.
"""
import csv, re, os, time, urllib.parse

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from make_hours_csv import make_driver, parse_hours
from naver_category import road_token, judge_by_category

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

TEST_LIMIT = 20  # 테스트로 앞에서 N개만 돌릴 때 정수 지정, 전체 적용 시 None


def _category_suspicious(category):
    """'영업 전/중/종료'처럼 영업시간 상태 라벨이 업종 자리에 잘못 들어온 경우."""
    return bool(re.match(r'^영업\s*(?:전|중|종료)', category or ''))


def _hours_suspicious(raw_text):
    """상태 라벨(영업 전/중/종료) 뒤에 시각이 없으면 아직 안 로드된 것으로 보고 재시도."""
    if not raw_text or raw_text.startswith('[ERR'):
        return bool(raw_text)  # 완전히 빈 값은 '정보 없음'이라 재시도 대상 아님
    m = re.match(r'^영업\s*(?:전|중|종료)', raw_text)
    return bool(m and not re.match(r'\s*\d', raw_text[m.end():]))


def fetch_once(driver, name, road_key):
    """
    entryIframe을 1회 열어 업종(span.mwWcl)과 영업시간 원본 텍스트를 동시에 수집.
    반환: dict(category, hours_raw, addr_check, status)
      status: 'ok' | 'not_found' | 'no_category' | 'error:<종류>'
    """
    query = f"{name} {road_key}".strip() if road_key else name
    url = f"https://map.naver.com/v5/search/{urllib.parse.quote(query)}"

    try:
        driver.get(url)
        time.sleep(4)
    except Exception as e:
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:load:{type(e).__name__}'}

    try:
        iframes = driver.find_elements(By.TAG_NAME, 'iframe')
        ids = [f.get_attribute('id') or '' for f in iframes]
    except Exception as e:
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:iframe_list:{type(e).__name__}'}

    if 'entryIframe' not in ids:
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': 'not_found'}

    try:
        WebDriverWait(driver, 7).until(EC.frame_to_be_available_and_switch_to_it(
            (By.CSS_SELECTOR, 'iframe#entryIframe')
        ))

        # 1) 업종 추출
        category = ''
        try:
            el = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'span.mwWcl'))
            )
            category = el.text.strip()
        except Exception:
            category = ''

        # 2) 펼쳐보기 클릭 (영업시간 요일별 상세표 열기)
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

        # 3) 업종/시각 데이터가 실제로 로드될 때까지 짧게 재확인
        body = ''
        for _ in range(3):
            body = driver.find_element(By.TAG_NAME, 'body').text
            if category or re.search(r'\d{1,2}:\d{2}', body) or '영업시간 정보 수정' in body:
                break
            time.sleep(1.0)
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
            hours_raw = m.group(0)[:500]
        else:
            m2 = re.search(r'영업\s*(?:종료|중|전).{0,200}', body)
            if m2:
                hours_raw = m2.group(0)[:200]

        driver.switch_to.default_content()

        addr_check = ''
        if category:
            addr_check = 'match' if (road_key and road_key in body) else 'unverified'

        status = 'ok' if category else 'no_category'
        return {'category': category, 'hours_raw': hours_raw, 'addr_check': addr_check, 'status': status}

    except Exception as e:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return {'category': '', 'hours_raw': '', 'addr_check': '', 'status': f'error:{type(e).__name__}'}


def fetch(driver, name, road_key, max_attempts=3):
    """업종 또는 영업시간 중 하나라도 오염/불완전하면 페이지를 다시 로드해 재시도."""
    info = {'category': '', 'hours_raw': '', 'addr_check': '', 'status': 'not_found'}
    for attempt in range(max_attempts):
        info = fetch_once(driver, name, road_key)
        if not _category_suspicious(info['category']) and not _hours_suspicious(info['hours_raw']):
            return info
        if attempt < max_attempts - 1:
            time.sleep(1.5)
    return info


def main():
    src_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
    with open(src_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    if TEST_LIMIT:
        rows = rows[:TEST_LIMIT]

    print(f"대상 업소 수: {len(rows)}건 (TEST_LIMIT={TEST_LIMIT})")
    print("Edge 드라이버 초기화 중...")
    driver = make_driver()
    print("시작. Edge 창이 열립니다.")

    bar_rows = []      # 주점의심_업체목록.csv
    non_bar_rows = []  # 비주점_업체목록.csv (정상 + 판별불가, 영업시간 포함)

    try:
        for i, row in enumerate(rows):
            name = row.get('가맹점명', '')
            address = row.get('소재지도로명주소', '') or row.get('주소정리', '')
            rk = road_token(row.get('도로명키', ''))

            try:
                info = fetch(driver, name, rk)
            except Exception as e:
                info = {'category': '', 'hours_raw': '', 'addr_check': '',
                         'status': f'error:unexpected:{type(e).__name__}'}

            verdict = judge_by_category(info['category']) if info['status'] == 'ok' else '판별불가'

            base = {
                '업소명':       name,
                '주소':         address,
                '업종명':       info['category'],
                '네이버기반판별': verdict,
                '주소확인':     info['addr_check'],
                '수집상태':     info['status'],
            }

            if verdict == '주점의심':
                bar_rows.append(base)
                hours_display = '(주점의심-영업시간 미조회)'
            else:
                open_t, close_t = parse_hours(info['hours_raw'])
                non_bar_rows.append({**base, '여는시간': open_t, '닫는시간': close_t})
                hours_display = f"{open_t}-{close_t}" if (open_t or close_t) else "영업시간정보없음"

            print(f"  [{i+1}/{len(rows)}] {name[:20]:20s} -> {verdict:6s} | "
                  f"업종:{info['category'] or '(없음)':10s} | {hours_display}")
            time.sleep(2.0)  # 네이버 요청 간격 (차단 방지)

    finally:
        driver.quit()

    bar_path = os.path.join(BASE_DIR, '주점의심_업체목록.csv')
    with open(bar_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['업소명', '주소', '업종명', '네이버기반판별', '주소확인', '수집상태'])
        writer.writeheader()
        writer.writerows(bar_rows)

    non_bar_path = os.path.join(BASE_DIR, '비주점_업체목록.csv')
    with open(non_bar_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            '업소명', '주소', '업종명', '네이버기반판별', '주소확인', '수집상태', '여는시간', '닫는시간'
        ])
        writer.writeheader()
        writer.writerows(non_bar_rows)

    found = sum(1 for r in non_bar_rows if r['닫는시간'])
    print(f"\n저장 완료:")
    print(f"  주점의심_업체목록.csv ({len(bar_rows)}건)")
    print(f"  비주점_업체목록.csv ({len(non_bar_rows)}건, 닫는시간 확인 {found}건)")


if __name__ == '__main__':
    main()
