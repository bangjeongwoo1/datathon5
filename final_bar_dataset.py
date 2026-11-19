# -*- coding: utf-8 -*-
"""
주점_네이버업종.csv에 영업시간(여는시간/닫는시간)을 더해 최종_주점의심데이터.csv를 만든다.

대상 선정:
  - 네이버기반판별 == '정상' 인 업소만 영업시간을 조회한다.
  - '주점의심'은 업종으로 이미 확정됐고, '판별불가'는 업종 정보 자체가 없어
    영업시간으로 교차검증할 근거도 없으므로 둘 다 크롤링 대상에서 제외.

영업시간 수집/파싱은 make_hours_csv.py의 get_hours/parse_hours/make_driver를
그대로 재사용한다 (별도로 다시 구현하지 않음 - 그 쪽에서 고친 "요일별 시간이
다를 때 최빈값으로 판단"/"라스트오더만 있어도 근사치로 채움" 로직이 그대로 적용됨).

출력: 최종_주점의심데이터.csv
  (업소명 / 주소 / 업종명 / 네이버기반판별 / 주소확인 / 수집상태 / 여는시간 / 닫는시간)
  → 주점_네이버업종.csv 자체는 읽기만 하고 수정하지 않음.
"""
import csv, os, time

from make_hours_csv import make_driver, get_hours, parse_hours
from naver_category import road_token

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_road_keys():
    """A_주점관련_검토후보.csv에서 가맹점명 → 도로명 핵심 토큰 매핑 (검색어 정확도용)."""
    path = os.path.join(BASE_DIR, 'A_주점관련_검토후보.csv')
    mapping = {}
    with open(path, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            mapping[row.get('가맹점명', '')] = road_token(row.get('도로명키', ''))
    return mapping


def main():
    src_path = os.path.join(BASE_DIR, '주점_네이버업종.csv')
    with open(src_path, 'r', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    road_keys = load_road_keys()

    targets = [r for r in rows if r['네이버기반판별'] == '정상']
    skipped = len(rows) - len(targets)
    print(f"전체 {len(rows)}건 중 영업시간 조회 대상: {len(targets)}건 "
          f"(주점의심/판별불가 {skipped}건은 조회 제외)")

    print("Edge 드라이버 초기화 중...")
    driver = make_driver()
    print("시작. Edge 창이 열립니다.")

    hours_map = {}
    try:
        for i, row in enumerate(targets):
            name = row['업소명']
            rk = road_keys.get(name, '')
            query_name = f"{name} {rk}" if rk else name

            try:
                raw = get_hours(driver, query_name)
                open_t, close_t = parse_hours(raw)
            except Exception:
                open_t = close_t = ''

            hours_map[name] = (open_t, close_t)

            status = f"{open_t}-{close_t}" if (open_t or close_t) else "정보없음"
            print(f"  [{i + 1}/{len(targets)}] {name[:20]:20s} -> {status}")
            time.sleep(1.5)  # 네이버 요청 간격 (차단 방지)

    finally:
        driver.quit()

    out_fieldnames = ['업소명', '주소', '업종명', '네이버기반판별', '주소확인', '수집상태', '여는시간', '닫는시간']
    out_rows = []
    for r in rows:
        open_t, close_t = hours_map.get(r['업소명'], ('', ''))
        out_rows.append({**r, '여는시간': open_t, '닫는시간': close_t})

    out_path = os.path.join(BASE_DIR, '최종_주점의심데이터.csv')
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=out_fieldnames)
        writer.writeheader()
        writer.writerows(out_rows)

    found = sum(1 for r in out_rows if r['닫는시간'])
    print(f"\n저장 완료: 최종_주점의심데이터.csv ({len(out_rows)}건)")
    print(f"  영업시간 조회 대상 {len(targets)}건 중 닫는시간 확인: {found}건")


if __name__ == '__main__':
    main()
