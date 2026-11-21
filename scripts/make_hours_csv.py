# -*- coding: utf-8 -*-
"""
Selenium + Edge로 네이버 지도 크롤링 → 영업시간 CSV 생성
대상: A_주점관련_검토후보.csv (57행) + 중복완료 이동분 29행 → 86행 전체
출력: 주점_영업시간.csv (가게명 / 오픈시각 / 닫는시각 / 원본영업시간)

네이버 지도 iframe 패턴:
  - entryIframe: 가게 상세 열림 → 펼쳐보기(JS 클릭) → "월 HH:MM - HH:MM" 형식 추출
  - searchIframe: 검색 목록 → 미리보기 텍스트에서 추출
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


def _is_suspicious(raw_text):
    """크롤링 결과가 불완전/오염된 것으로 보이면 True (재시도 대상)."""
    if not raw_text or raw_text.startswith('[ERR'):
        return True
    # "영업 전/중/종료" 라벨 뒤에 시각(숫자)이 아닌 다른 텍스트(리뷰 수 등)가
    # 바로 붙어있으면, 시각 데이터가 로드되기 전에 캡처된 것으로 간주.
    m = re.match(r'^영업\s*(?:전|중|종료)', raw_text)
    if m and not re.match(r'\s*\d', raw_text[m.end():]):
        return True
    return False


def _fetch_once(driver, name):
    query = f"{name} 춘천"
    url   = f"https://map.naver.com/v5/search/{urllib.parse.quote(query)}"
    driver.get(url)
    time.sleep(5)   # 페이지 로드 + 차단 방지

    wait    = WebDriverWait(driver, 7)
    iframes = driver.find_elements(By.TAG_NAME, 'iframe')
    ids     = [f.get_attribute('id') or '' for f in iframes]
    raw_text = ''

    if 'entryIframe' in ids:
        try:
            wait.until(EC.frame_to_be_available_and_switch_to_it(
                (By.CSS_SELECTOR, 'iframe#entryIframe')
            ))
            # 펼쳐보기 버튼이 실제로 나타날 때까지 기다린 뒤 클릭
            try:
                blind = WebDriverWait(driver, 5).until(
                    EC.presence_of_element_located((By.XPATH,
                        '//*[contains(@class,"place_blind") and contains(text(),"펼쳐보기")]'))
                )
                clickable = blind.find_element(By.XPATH, '..')
                driver.execute_script("arguments[0].click();", clickable)
                # 클릭이 실제로 반영됐는지("접기"로 전환) 확인, 안 되면 짧게 대기만
                try:
                    WebDriverWait(driver, 4).until(
                        lambda d: '접기' in d.find_element(By.TAG_NAME, 'body').text
                    )
                except Exception:
                    time.sleep(1.5)
            except Exception:
                pass

            # 시각 데이터(HH:MM)가 실제로 로드될 때까지 짧게 재확인 (최대 3회)
            body = ''
            for _ in range(3):
                body = driver.find_element(By.TAG_NAME, 'body').text
                if re.search(r'\d{1,2}:\d{2}', body) or '영업시간 정보 수정' in body:
                    break
                time.sleep(1.0)

            # 멀티라인: "영업시간" ~ "접기" 또는 "영업시간 수정" 구간
            m = re.search(r'영업시간\s*([\s\S]{0,800}?)(?:접기|영업시간 수정)', body)
            if m:
                raw_text = m.group(0)[:800]
            else:
                # 펼쳐보기 없거나 미적용 → 현재 상태 텍스트
                m2 = re.search(r'영업\s*(?:종료|중|전).{0,200}', body)
                if m2:
                    raw_text = m2.group(0)[:200]

            driver.switch_to.default_content()
        except Exception as e:
            driver.switch_to.default_content()
            raw_text = f"[ERR_entry:{type(e).__name__}]"

    elif 'searchIframe' in ids:
        try:
            driver.switch_to.frame('searchIframe')
            body = driver.find_element(By.TAG_NAME, 'body').text
            m = re.search(r'영업\s*(?:종료|중|전|시간).{0,200}', body)
            if m:
                raw_text = m.group(0)[:200]
            if not raw_text:
                pairs = re.findall(r'\d{1,2}:\d{2}\s*[-~]\s*\d{1,2}:\d{2}', body)
                if pairs:
                    raw_text = pairs[0]
            driver.switch_to.default_content()
        except Exception as e:
            driver.switch_to.default_content()
            raw_text = f"[ERR_search:{type(e).__name__}]"

    return raw_text


def get_hours(driver, name, max_attempts=3):
    """불완전/오염된 결과면 페이지를 다시 로드해서 재시도."""
    raw_text = ''
    for attempt in range(max_attempts):
        raw_text = _fetch_once(driver, name)
        if not _is_suspicious(raw_text):
            return raw_text
        if attempt < max_attempts - 1:
            time.sleep(1.5)
    return raw_text


def parse_hours(raw_text):
    """
    요일별로 영업시간이 다를 수 있으므로, 텍스트에 등장하는 모든 'HH:MM - HH:MM'
    (자정 넘김 "다음 날 HH:MM" 표기 포함) 패턴을 전부 모아서 가장 많이 등장하는
    (= 대표/평균적인) 시간대를 고른다. 요일 하나만 보고 바로 반환하지 않는다.
    """
    if not raw_text or raw_text.startswith('[ERR'):
        return '', ''

    # 형식 1: HH:MM - HH:MM / HH:MM - 다음 날 HH:MM (요일별 영업시간, 전부 수집)
    pairs = re.findall(
        r'(\d{1,2}:\d{2})\s*[-~]\s*(?:다음\s*날\s*)?(\d{1,2}:\d{2})', raw_text
    )
    candidates = []
    for o, c in pairs:
        om = re.match(r'(\d{1,2}):(\d{2})', o)
        cm = re.match(r'(\d{1,2}):(\d{2})', c)
        if not om or not cm:
            continue
        oh   = int(om.group(1)); omm_v = int(om.group(2))
        ch_  = int(cm.group(1)); cmm_v = int(cm.group(2))
        o_m  = oh * 60 + omm_v
        c_m  = ch_ * 60 + cmm_v
        if 840 <= o_m <= 1020 and 900 <= c_m <= 1080:  # 브레이크 타임 제외
            continue
        candidates.append((o, c, o_m, c_m))

    open_t = close_t = ''

    if candidates:
        # 요일마다 같은 시간대가 반복되므로, 가장 자주 등장한(최빈값) 시간대를 대표로 선택.
        # 요일별로 영업시간이 달라도(평일/주말 등) 가장 흔한 패턴을 고르게 되어
        # "첫 번째 요일만 보고 결정" 하던 기존 방식보다 날짜별 차이에 안정적임.
        counts = {}
        for o, c, _, _ in candidates:
            counts[(o, c)] = counts.get((o, c), 0) + 1
        max_count = max(counts.values())
        tied = [oc for oc, cnt in counts.items() if cnt == max_count]
        if len(tied) == 1:
            open_t, close_t = tied[0]
        else:
            # 동률이면 영업시간이 가장 긴 패턴 선택
            def dur(oc):
                o, c = oc
                om = re.match(r'(\d{1,2}):(\d{2})', o)
                cm = re.match(r'(\d{1,2}):(\d{2})', c)
                o_m = int(om.group(1)) * 60 + int(om.group(2))
                c_m = int(cm.group(1)) * 60 + int(cm.group(2))
                return 1440 - o_m + c_m if c_m < o_m else c_m - o_m
            open_t, close_t = max(tied, key=dur)

    # 형식 2: "HH시 HH분에 영업 시작" / "HH시 HH분에 영업 종료"
    if not open_t:
        open_m = re.search(r'(\d{1,2})시\s*(\d{0,2})분?에\s*영업\s*시작', raw_text)
        if open_m:
            open_t = f"{int(open_m.group(1)):02d}:{int(open_m.group(2) or 0):02d}"
    if not close_t:
        close_m = re.search(r'(\d{1,2})시\s*(\d{0,2})분?에\s*(?:영업\s*)?종료', raw_text)
        if close_m:
            close_t = f"{int(close_m.group(1)):02d}:{int(close_m.group(2) or 0):02d}"

    # 형식 3: "영업 종료HH:MM에 영업 시작" → HH:MM이 다음 오픈 시각
    if not open_t:
        m3 = re.search(r'(\d{1,2}:\d{2})에\s*영업\s*시작', raw_text)
        if m3:
            open_t = m3.group(1)

    # 형식 4: 닫는시각 표기가 전혀 없고 "라스트오더" 시각만 있는 경우 →
    # 실제 마감과는 다를 수 있지만, 정보가 아예 없는 것보다는 근사치로라도 채움.
    if not close_t:
        m4 = re.search(r'(\d{1,2}:\d{2})\s*에?\s*라스트오더', raw_text)
        if m4:
            close_t = m4.group(1)

    return open_t, close_t


def main():
    # ── 대상 매장 수집 ──────────────────────────────────────
    bar_path  = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
    done_path = os.path.join(BASE_DIR, '중복의심_검토_완료.csv')

    with open(bar_path, 'r', encoding='utf-8-sig') as f:
        bar_rows = list(csv.DictReader(f))
    with open(done_path, 'r', encoding='utf-8-sig') as f:
        done_rows = list(csv.DictReader(f))

    moved_rows = [r for r in done_rows if r.get('검토결과', '') == '주점아님(자정전종료)']
    all_rows   = bar_rows + moved_rows
    print(f"검색 대상: {len(all_rows)}행 (검토후보 {len(bar_rows)} + 이동 {len(moved_rows)})")

    # ── 크롤링 ──────────────────────────────────────────────
    print("Edge 드라이버 초기화 중...")
    driver = make_driver()
    print("시작. Edge 창이 열립니다.")

    hours_log = []
    try:
        for i, row in enumerate(all_rows):
            name = row['가맹점명']
            try:
                raw    = get_hours(driver, name)
                open_t, close_t = parse_hours(raw)
            except Exception as e:
                raw    = f"[EX:{e}]"
                open_t = close_t = ''

            hours_log.append({
                '가게명':     name,
                '오픈시각':   open_t,
                '닫는시각':   close_t,
                '원본영업시간': (raw or '')[:500],
            })

            status = f"{open_t}-{close_t}" if open_t or close_t else "정보없음"
            print(f"  [{i+1:2d}/{len(all_rows)}] {name[:20]:20s} → {status}")
            time.sleep(1.0)   # 가맹점 간 대기 → 차단 방지용으로 늘림

    finally:
        driver.quit()

    # ── 저장 ────────────────────────────────────────────────
    out_path = os.path.join(BASE_DIR, '주점_영업시간.csv')
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['가게명', '오픈시각', '닫는시각', '원본영업시간'])
        writer.writeheader()
        writer.writerows(hours_log)

    found = sum(1 for r in hours_log if r['닫는시각'])
    print(f"\n저장 완료: 주점_영업시간.csv ({len(hours_log)}행)")
    print(f"  마감시각 확인: {found}건 / 정보없음: {len(hours_log)-found}건")


if __name__ == '__main__':
    main()
