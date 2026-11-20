-- 003 (나중에 적용): 크롤링이 끝나고 지도의 가게 목록을 merchant_crawl_staging 으로 바꿀 때 적용한다.
--
-- 이 later/ 폴더는 migrate.js 가 읽지 않으므로 `node migrate.js` 로 실수로 적용되지 않는다.
-- 적용 방법: Supabase SQL Editor 에 이 파일 내용을 붙여넣어 실행한다. (소유자 확인 후)
--
-- 하는 일 (한 번의 트랜잭션: 하나라도 실패하면 전부 되돌려진다)
--   1) 옛 가게 목록(merchants) 연결을 끊는다.
--   2) 옛 번호(CC-000001 …)로 저장된 제보·메뉴를, 제출 당시 가게 이름·주소(merchant_name,
--      merchant_address)로 staging 의 새 번호를 찾아 바꾼다.
--      → 이름이 같고 도로명+건물번호가 같은 staging 행이 "정확히 한 곳"일 때만 바꾼다.
--   3) 메뉴 테이블이 staging 의 기본키(merchant_id)를 가리키게 연결한다.
--      → 바꾸지 못한 옛 번호 행이 하나라도 남아 있으면 이 단계가 실패하고 전체가 되돌려진다.
--
-- 적용 전에 확인할 것
--   a) 지도의 가게 목록(/api/merchants)이 staging 번호를 주도록 바뀌었나
--   b) 적용 직후 backend/.env 에 MERCHANT_SOURCE_TABLE=merchant_crawl_staging 을 넣고 서버를 다시 켤 준비가 됐나
--   c) 바꾸지 못할 행이 몇 개인지 미리 보려면, 이 파일을 실행하기 전에 아래를 먼저 실행해 본다.
--        SELECT submission_id, merchant_id, merchant_name FROM public.menu_submissions
--         WHERE merchant_id !~ '^[0-9]+$';   -- 옛 번호로 저장된 제보 목록
--   d) 이 연결을 걸면 merchant_crawl_staging 을 비우거나(TRUNCATE) 지우는 작업이 막히고,
--      staging 행을 지우면 그 가게의 menus 가 함께 지워진다(menu_submissions 는 막힘).
--
-- 여러 번 실행해도 안전하다.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.merchant_crawl_staging') IS NULL THEN
    RAISE EXCEPTION 'merchant_crawl_staging 이 이 DB에 없습니다. 적용을 중단합니다.';
  END IF;
END $$;

-- 1) 옛 가게 목록(merchants) 연결을 끊는다.
ALTER TABLE public.menu_submissions DROP CONSTRAINT IF EXISTS menu_submissions_merchant_id_fkey;
ALTER TABLE public.menus            DROP CONSTRAINT IF EXISTS menus_merchant_id_fkey;

-- 2) 옛 번호로 저장된 제보의 번호를 새 번호로 바꾼다.
--    비교 기준: 가게 이름이 같고, 도로명+건물번호(예: "공지로70-57")가 같은 staging 행이 정확히 한 곳.
WITH candidate AS (
  SELECT sub.submission_id,
         st.merchant_id AS new_id,
         COUNT(*) OVER (PARTITION BY sub.submission_id) AS matches
    FROM public.menu_submissions sub
    JOIN public.merchant_crawl_staging st
      ON st."mrhstNm" = sub.merchant_name
     AND array_to_string(regexp_match(st."rdnmadr",
           '([가-힣0-9]+(?:로|길)(?:[0-9]+번길)?)\s*([0-9]+(?:-[0-9]+)?)'), '')
       = array_to_string(regexp_match(sub.merchant_address,
           '([가-힣0-9]+(?:로|길)(?:[0-9]+번길)?)\s*([0-9]+(?:-[0-9]+)?)'), '')
   WHERE sub.merchant_id !~ '^[0-9]+$'
)
UPDATE public.menu_submissions sub
   SET merchant_id = candidate.new_id
  FROM candidate
 WHERE candidate.submission_id = sub.submission_id
   AND candidate.matches = 1;

--    확정 메뉴(menus)는 자기가 나온 제보(submission_id)의 번호를 따라간다.
UPDATE public.menus m
   SET merchant_id = sub.merchant_id
  FROM public.menu_submissions sub
 WHERE m.submission_id = sub.submission_id
   AND m.merchant_id <> sub.merchant_id;

-- 3) staging 의 기본키(merchant_id)로 연결한다.
--    바꾸지 못한 옛 번호 행이 남아 있으면 여기서 실패하고, 위의 모든 변경이 되돌려진다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_submissions_staging_fkey') THEN
    ALTER TABLE public.menu_submissions
      ADD CONSTRAINT menu_submissions_staging_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchant_crawl_staging (merchant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_staging_fkey') THEN
    ALTER TABLE public.menus
      ADD CONSTRAINT menus_staging_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchant_crawl_staging (merchant_id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
