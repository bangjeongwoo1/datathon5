-- 003: 가게 정보의 메인 테이블을 merchants 에서 merchant_crawl_staging 으로 바꾼다.
--
-- 이 later/ 폴더는 migrate.js 가 읽지 않으므로 `node migrate.js` 로 실수로 적용되지 않는다.
-- 적용 방법: Supabase SQL Editor 에 이 파일 내용을 붙여넣어 실행한다. (소유자·팀원 확인 후)
--
-- 하는 일 (한 번의 트랜잭션: 하나라도 실패하면 전부 되돌려진다)
--   1) 메뉴 제보(menu_submissions)·확정 메뉴(menus)·리뷰(reviews)의 merchants 연결을 끊는다.
--   2) 옛 가게 번호(CC-000001 …)를 staging 의 새 번호(1, 2, 3 …)로 바꾼다.
--      기준 1: 가게 이름이 같고 도로명+건물번호(예: "영서로3065")가 같은 staging 행이 정확히 한 곳.
--      기준 2: 위로 못 찾으면, 이름이 같고 같은 시군구인 staging 행이 정확히 한 곳.
--      → 모호하거나(여러 곳) 못 찾는 번호가 하나라도 있으면 어떤 번호인지 알리고 전체를 취소한다.
--   3) 세 표가 staging 의 기본키(merchant_id)를 가리키게 연결한다.
--   4) 리뷰 집계 뷰(merchant_review_summary)를 staging 기준으로 다시 만든다.
--
-- merchants, merchant_naver_info 는 지우지 않는다. (더는 쓰지 않을 뿐, 되돌아갈 길을 남겨 둔다.)
--
-- 적용 전에 확인할 것
--   a) 이 변경과 함께 서버(Render) 코드가 staging 을 읽도록 같이 배포되어야 한다.
--      DB만 바꾸고 서버를 안 바꾸면 리뷰·만원 이하 필터·사진 제보가 잠시 동작하지 않는다.
--   b) 리뷰는 팀원 담당 기능이다. 적용 전에 알린다.
--   c) 이 연결을 걸면 merchant_crawl_staging 을 비우거나(TRUNCATE) 지우는 작업이 막힌다.
--      크롤링으로 다시 채울 때는 행을 지우지 말고 갱신(UPDATE/UPSERT)하고, merchant_id 를 바꾸지 않는다.
--      (staging 행을 지우면 그 가게의 menus 는 함께 지워지고, 제보·리뷰가 있는 행은 지울 수 없다.)
--
-- 여러 번 실행해도 안전하다.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.merchant_crawl_staging') IS NULL THEN
    RAISE EXCEPTION 'merchant_crawl_staging 이 이 DB에 없습니다. 적용을 중단합니다.';
  END IF;
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'merchants 가 이 DB에 없어 옛 번호를 새 번호로 바꿀 수 없습니다. 적용을 중단합니다.';
  END IF;
END $$;

-- 1) 옛 가게 목록(merchants) 연결을 끊는다.
ALTER TABLE public.menu_submissions DROP CONSTRAINT IF EXISTS menu_submissions_merchant_id_fkey;
ALTER TABLE public.menus            DROP CONSTRAINT IF EXISTS menus_merchant_id_fkey;
ALTER TABLE public.reviews          DROP CONSTRAINT IF EXISTS reviews_merchant_id_fkey;

-- 2) 옛 번호 -> 새 번호 대응표.
--    옛 번호의 이름·주소·시군구는 merchants 에서 찾고, 없으면 제보에 함께 저장해 둔 이름·주소를 쓴다.
CREATE TEMP TABLE _id_map ON COMMIT DROP AS
WITH used AS (
  SELECT merchant_id FROM public.menu_submissions
  UNION SELECT merchant_id FROM public.menus
  UNION SELECT merchant_id FROM public.reviews
),
olds AS (
  SELECT u.merchant_id AS old_id,
         COALESCE(m.name, snap.merchant_name)       AS name,
         COALESCE(m.address, snap.merchant_address) AS address,
         m.region                                   AS region,
         array_to_string(regexp_match(COALESCE(m.address, snap.merchant_address),
           '([가-힣0-9]+(?:로|길)(?:[0-9]+번길)?)[[:space:]]*(?:지하)?([0-9]+(?:-[0-9]+)?)'), '') AS addr_key
    FROM used u
    LEFT JOIN public.merchants m ON m.merchant_id = u.merchant_id
    LEFT JOIN LATERAL (
      SELECT s.merchant_name, s.merchant_address
        FROM public.menu_submissions s
       WHERE s.merchant_id = u.merchant_id AND s.merchant_name IS NOT NULL
       ORDER BY s.submission_id DESC LIMIT 1
    ) snap ON TRUE
   WHERE u.merchant_id !~ '^[0-9]+$'          -- 이미 새 번호인 행은 건너뛴다(여러 번 실행해도 안전)
),
by_addr AS (
  SELECT o.old_id, COUNT(st.merchant_id) AS cnt, MIN(st.merchant_id) AS new_id
    FROM olds o
    JOIN public.merchant_crawl_staging st
      ON st."mrhstNm" = o.name
     AND o.addr_key <> ''
     AND array_to_string(regexp_match(st."rdnmadr",
           '([가-힣0-9]+(?:로|길)(?:[0-9]+번길)?)[[:space:]]*(?:지하)?([0-9]+(?:-[0-9]+)?)'), '') = o.addr_key
   GROUP BY o.old_id
),
by_name AS (
  SELECT o.old_id, COUNT(st.merchant_id) AS cnt, MIN(st.merchant_id) AS new_id
    FROM olds o
    JOIN public.merchant_crawl_staging st
      ON st."mrhstNm" = o.name
     AND (o.region IS NULL OR st."signguNm" = o.region)
   GROUP BY o.old_id
)
SELECT o.old_id,
       CASE WHEN a.cnt = 1 THEN a.new_id
            WHEN n.cnt = 1 THEN n.new_id END AS new_id
  FROM olds o
  LEFT JOIN by_addr a ON a.old_id = o.old_id
  LEFT JOIN by_name n ON n.old_id = o.old_id;

-- 못 옮기는 번호가 있으면 여기서 멈추고 전체를 되돌린다. (어떤 번호인지 오류 메시지에 나온다.)
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(old_id, ', ' ORDER BY old_id) INTO bad FROM _id_map WHERE new_id IS NULL;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '새 번호를 찾지 못했거나 후보가 여러 곳인 옛 번호가 있어 중단합니다(전체 되돌림): %', bad;
  END IF;
END $$;

UPDATE public.menu_submissions t SET merchant_id = m.new_id FROM _id_map m WHERE t.merchant_id = m.old_id;
UPDATE public.menus            t SET merchant_id = m.new_id FROM _id_map m WHERE t.merchant_id = m.old_id;
UPDATE public.reviews          t SET merchant_id = m.new_id FROM _id_map m WHERE t.merchant_id = m.old_id;

-- 3) staging 의 기본키(merchant_id)로 연결한다.
--    새 번호가 staging 에 없는 행이 남아 있으면 여기서 실패하고, 위의 모든 변경이 되돌려진다.
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

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_staging_fkey') THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_staging_fkey
      FOREIGN KEY (merchant_id) REFERENCES public.merchant_crawl_staging (merchant_id);
  END IF;
END $$;

-- 4) 리뷰 집계 뷰를 staging 기준으로 다시 만든다. (열 이름·형식은 그대로라 권한도 유지된다.)
CREATE OR REPLACE VIEW public.merchant_review_summary AS
SELECT
  m.merchant_id,
  count(r.id)::int AS review_count,
  round(avg(r.rating)::numeric, 2) AS avg_rating
FROM public.merchant_crawl_staging m
LEFT JOIN public.reviews r ON r.merchant_id = m.merchant_id
GROUP BY m.merchant_id;

COMMIT;
