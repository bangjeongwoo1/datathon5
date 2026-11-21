# -*- coding: utf-8 -*-
"""
A_주점관련_검토후보.csv의 업소들을 네이버 지도/플레이스에서 검색해
업종 정보(span.mwWcl)를 수집하는 독립 스크립트.

※ 기존 시간 기반 주점 판별 로직(midnight_classify.py, final_classify.py,
   make_hours_csv.py 등)은 이 스크립트가 전혀 참조/수정하지 않음.
   완전히 별도의 판별 축(네이버 등록 업종 기준)을 추가하는 용도.

동작:
  1. map.naver.com 검색 → entryIframe 진입 (make_hours_csv.py와 동일한 패턴)
  2. span.mwWcl에서 업종 텍스트 추출 (실패 시 보수적 폴백 1회 시도)
  3. 주소 핵심 토큰(도로명키)이 상세페이지 본문에 실제로 등장하는지 확인
     → 동일 업체인지 교차 검증(주소 기반)
  4. 네이버 업종명에 주류 관련 키워드가 있으면 "주점의심"으로 별도 판별

출력: 주점_네이버업종.csv (업소명 / 주소 / 업종명 / 네이버기반판별 / 주소확인 / 수집상태)
      → 기존 CSV/컬럼은 읽기만 하고 절대 덮어쓰지 않음.

TEST_LIMIT:
  1  → 1개 업체만 테스트 수집 (기본값, 먼저 이걸로 확인)
  None → 전체 업소 대상으로 수집
"""
import csv, re, os, time, urllib.parse

from selenium import webdriver
from selenium.webdriver.edge.service import Service
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.microsoft import EdgeChromiumDriverManager

# 스크립트는 scripts/ 에, 입력·출력 CSV 는 data/주점판별/ 에 둔다.
# (data/ 바로 아래에 두면 scripts/generate_merchants.py 가 A_ 로 시작하는 검토용 CSV 를 가맹점 원본으로 잘못 읽을 수 있다.)
BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', '주점판별')

TEST_LIMIT = None  # 전체 적용 시 None으로 변경

# 네이버 업종명에 아래 키워드(bad word)가 포함되면 "주점의심"으로 판별
# (기존 시간기반 판별과는 독립적인 별도 기준). '주점'/'와인'/'호프'/'맥주'는
# 포함되는 모든 단어(민속주점, 와인바, 수입맥주 등)를 잡기 위한 부분일치 키워드.
BAR_CATEGORY_KEYWORDS = [
    '술집', '주점', '바(BAR)', '라운지바', '루프탑바', '칵테일바',
    '와인', '이자카야', '오뎅', '꼬치', '포장마차', '호프', '맥주',
    '소주방', '대포집', '라이브카페',
]


def make_driver():
    opts = Options()
    opts.add_argument('--window-size=1280,900')
    opts.add_argument('--lang=ko-KR')
    opts.add_argument(
        'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
    )
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    opts.add_experimental_option('useAutomationExtension', False)
    drv = webdriver.Edge(
        service=Service(EdgeChromiumDriverManager().install()),
        options=opts
    )
    drv.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument',
        {'source': "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"})
    return drv


def road_token(addr):
    """'우묵길78번길 7' 같은 도로명키에서 건물번호 앞까지(도로명)만 추출."""
    if not addr:
        return ''
    m = re.match(r'([가-힣0-9]+(?:로|길))', addr.strip())
    return m.group(1) if m else addr.strip()[:6]


def get_category(driver, name, road_key):
    """
    네이버 지도에서 업체를 검색해 업종(span.mwWcl)과 주소 교차검증 결과를 수집.
    반환: dict(category, addr_check, status)
      status: 'ok' | 'not_found' | 'no_category' | 'error:<종류>'
      addr_check: 'match' | 'unverified' | '' (수집 실패 시)
    """
    query = f"{name} {road_key}".strip() if road_key else name
    url = f"https://map.naver.com/v5/search/{urllib.parse.quote(query)}"

    try:
        driver.get(url)
        time.sleep(4)
    except Exception as e:
        return {'category': '', 'addr_check': '', 'status': f'error:load:{type(e).__name__}'}

    try:
        iframes = driver.find_elements(By.TAG_NAME, 'iframe')
        ids = [f.get_attribute('id') or '' for f in iframes]
    except Exception as e:
        return {'category': '', 'addr_check': '', 'status': f'error:iframe_list:{type(e).__name__}'}

    if 'entryIframe' not in ids:
        return {'category': '', 'addr_check': '', 'status': 'not_found'}

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
            category = ''  # 셀렉터가 바뀌었거나 업종 표시가 없는 경우 → 수집실패로 기록(아래에서 처리)

        body = ''
        try:
            body = driver.find_element(By.TAG_NAME, 'body').text
        except Exception:
            pass

        if not category:
            # 보수적 폴백: body 텍스트에서 "업종" 유사 패턴 재탐색 (한 번만 시도)
            m = re.search(r'\n([가-힣]{2,10}(?:,[가-힣]{2,10})?)\n', body) if body else None
            if m:
                category = m.group(1).strip()

        driver.switch_to.default_content()

        addr_check = ''
        if category:
            addr_check = 'match' if (road_key and road_key in body) else 'unverified'

        if not category:
            return {'category': '', 'addr_check': '', 'status': 'no_category'}
        return {'category': category, 'addr_check': addr_check, 'status': 'ok'}

    except Exception as e:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return {'category': '', 'addr_check': '', 'status': f'error:{type(e).__name__}'}


def judge_by_category(category):
    """네이버 업종명 기준 주점 의심 여부 판별 (기존 시간기반 판별 결과와 완전히 독립적인 별도 축)."""
    if not category:
        return '판별불가'
    for kw in BAR_CATEGORY_KEYWORDS:
        if kw in category:
            return '주점의심'
    return '정상'


def main():
    candidate_path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
    with open(candidate_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    if TEST_LIMIT:
        rows = rows[:TEST_LIMIT]

    print(f"대상 업소 수: {len(rows)}건 (TEST_LIMIT={TEST_LIMIT})")
    print("Edge 드라이버 초기화 중...")
    driver = make_driver()
    print("시작. Edge 창이 열립니다.")

    results = []
    try:
        for i, row in enumerate(rows):
            name = row.get('가맹점명', '')
            address = row.get('소재지도로명주소', '') or row.get('주소정리', '')
            rk = road_token(row.get('도로명키', ''))

            try:
                info = get_category(driver, name, rk)
            except Exception as e:
                info = {'category': '', 'addr_check': '', 'status': f'error:unexpected:{type(e).__name__}'}

            verdict = judge_by_category(info['category']) if info['status'] == 'ok' else '판별불가'

            results.append({
                '업소명':       name,
                '주소':         address,
                '업종명':       info['category'],
                '네이버기반판별': verdict,
                '주소확인':     info['addr_check'],
                '수집상태':     info['status'],
            })

            status_display = info['category'] or f"({info['status']})"
            print(f"  [{i+1}/{len(rows)}] {name[:20]:20s} -> {status_display}")
            time.sleep(2.0)  # 네이버 요청 간격 (차단 방지, 기존 수집 스크립트보다 여유있게)

    finally:
        driver.quit()

    out_path = os.path.join(BASE_DIR, '주점_네이버업종.csv')
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['업소명', '주소', '업종명', '네이버기반판별', '주소확인', '수집상태'])
        writer.writeheader()
        writer.writerows(results)

    ok = sum(1 for r in results if r['수집상태'] == 'ok')
    print(f"\n저장 완료: 주점_네이버업종.csv ({len(results)}건)")
    print(f"  업종 수집 성공: {ok}건 / 실패: {len(results) - ok}건")


if __name__ == '__main__':
    main()
