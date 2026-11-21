# -*- coding: utf-8 -*-
"""
업소 데이터(원본) + 업종기타_재분류검토 + 중복의심_검토를 하나로 합쳐,
naver_merged_scan.py가 돌릴 통합 대상 CSV(주점판별_대상통합.csv)를 만든다.

처리 순서 (요청하신 순서 그대로):
  1. 업소 데이터(원본) / 업종기타_재분류검토 / 중복의심_검토 로드
  2. 업종기타_재분류검토 처리
     - 실제로 "기타" 업종을 재분류하는 전용 로직은 존재하지 않는다(확인됨).
       naver_merged_scan.py의 네이버 업종 조회가 그 역할을 대신하기로 이미
       합의했으므로, 여기서는 그대로 통과시킨다. 다만 수동으로 채워진
       `확인된_실제업종`/`근거` 값이 있다면 원본에 반영한다.
  3. 중복의심_검토 처리
     - dedup_review.py의 run_dedup_review()를 그대로 재사용 (판단 로직 변경 없음).
     - 주의: 이 결과를 `중복의심_검토_완료.csv`에 다시 저장하지 않는다.
       그 파일은 dedup_review.py의 원래 출력일 뿐 아니라 midnight_classify.py가
       이후 행을 추가로 이동시켜 넣는 공유 파일이라, 여기서 덮어쓰면 그 작업
       내용이 사라진다. 그래서 이 단계의 결과는 통합 과정에서만 메모리로 사용한다.
  4. 중복 제거로 대표행이 아니게 된(=제거된) 가맹점ID를 원본에서 빼고,
     업종기타 재분류 결과(있다면)를 반영해 하나의 통합 데이터셋을 만든다.
     (주점관련_검토후보 관련 처리는 이 파이프라인에서 더 이상 사용하지 않음)
  5. 통합 결과를 저장 → naver_merged_scan.py(SRC_FILE)가 그대로 읽어
     주점/비주점 분류 + 비주점 영업시간 크롤링을 수행한다 (해당 로직은 변경하지 않음).

입력 3개 CSV는 읽기만 하고 수정하지 않는다.
원본 업소 데이터(ORIGINAL_FILE)는 현재 로컬에 없음 - 생기면 그대로 동작한다.
"""
import csv, os

import dedup_review

# 스크립트는 scripts/ 에, 입력·출력 CSV 는 data/주점판별/ 에 둔다.
# (data/ 바로 아래에 두면 scripts/generate_merchants.py 가 A_ 로 시작하는 검토용 CSV 를 가맹점 원본으로 잘못 읽을 수 있다.)
BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', '주점판별')

ORIGINAL_FILE = 'A_지도용_검토상태포함.csv'    # 업소 데이터(원본), 전체 가맹점
CATEGORY_REVIEW_FILE = 'A_업종기타_재분류검토.csv'
DUPLICATE_REVIEW_FILE = 'A_중복의심_검토.csv'

OUT_PATH = os.path.join(BASE_DIR, '주점판별_대상통합.csv')

# 업종기타_재분류검토에만 있고 원본에는 없는 컬럼 중, 값이 있으면 원본에 반영할 것들
CATEGORY_EXTRA_COLS = ['확인된_실제업종', '근거']


def load_rows(filename):
    path = os.path.join(BASE_DIR, filename)
    with open(path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        return reader.fieldnames, list(reader)


def main():
    # ── 1. 데이터 로드 ──────────────────────────────────
    orig_fields, orig_rows = load_rows(ORIGINAL_FILE)
    _, category_rows = load_rows(CATEGORY_REVIEW_FILE)
    _, duplicate_rows = load_rows(DUPLICATE_REVIEW_FILE)

    print(f"업소 데이터(원본): {len(orig_rows)}건")
    print(f"업종기타_재분류검토: {len(category_rows)}건")
    print(f"중복의심_검토: {len(duplicate_rows)}건")

    # ── 2. 업종기타_재분류검토 처리 ─────────────────────
    # 재분류 전용 로직이 없어 그대로 통과. 수동으로 채워진 값만 가맹점ID 기준으로 수집.
    category_updates = {}
    for row in category_rows:
        gid = row.get('가맹점ID', '')
        if not gid:
            continue
        values = {c: row.get(c, '') for c in CATEGORY_EXTRA_COLS if row.get(c, '')}
        if values:
            category_updates[gid] = values
    print(f"  → 실제로 재분류값이 채워진 행: {len(category_updates)}건 (없으면 0건, 정상)")

    # ── 3. 중복의심_검토 처리 (기존 dedup_review 로직 재사용, 파일 재저장 없음) ──
    deduped, human_review = dedup_review.run_dedup_review(duplicate_rows)

    input_ids = {r.get('가맹점ID', '') for r in duplicate_rows if r.get('가맹점ID', '')}
    kept_ids = {r.get('가맹점ID', '') for r in deduped if r.get('가맹점ID', '')}
    review_ids = {r.get('가맹점ID', '') for r in human_review if r.get('가맹점ID', '')}
    removed_ids = input_ids - kept_ids - review_ids  # 대표행이 아니라서 실제로 제거되는 ID

    review_reason = {r['가맹점ID']: r.get('비고', '') for r in human_review if r.get('가맹점ID', '')}

    print(f"\n중복의심 처리 결과: 대표 유지 {len(kept_ids)}건, 인간검수 {len(review_ids)}건, "
          f"중복 제거(원본에서 제외) {len(removed_ids)}건")

    # ── 4. 원본 업소 데이터에 반영 및 통합 ──────────────
    extra_fields = [c for c in CATEGORY_EXTRA_COLS if c not in orig_fields]
    if '검토결과' not in orig_fields:
        extra_fields.append('검토결과')
    if '비고' not in orig_fields:
        extra_fields.append('비고')
    out_fields = orig_fields + extra_fields

    integrated = []
    for row in orig_rows:
        gid = row.get('가맹점ID', '')
        if gid and gid in removed_ids:
            continue  # 중복의심 처리 결과 → 제거 대상

        full_row = {fn: row.get(fn, '') for fn in out_fields}
        if gid in category_updates:
            full_row.update(category_updates[gid])
        if gid in review_ids:
            full_row['검토결과'] = full_row.get('검토결과') or '인간검수필요'
            full_row['비고'] = full_row.get('비고') or review_reason.get(gid, '')
        integrated.append(full_row)

    print(f"\n원본 {len(orig_rows)}건 중 중복 제거 {len(removed_ids)}건 제외 "
          f"→ 통합 {len(integrated)}건 (컬럼 {len(out_fields)}개)")

    with open(OUT_PATH, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        writer.writerows(integrated)

    print(f"\n저장 완료: {os.path.basename(OUT_PATH)} ({len(integrated)}건)")


if __name__ == '__main__':
    main()
