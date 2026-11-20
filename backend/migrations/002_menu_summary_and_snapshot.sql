-- 002: (1) 제보에 "제출 당시의 가게 이름·주소"를 같이 저장하는 열 추가
--      (2) 가게별 "1만 원 이하 식사 있음/없음/모름" 판정을 요약 뷰에 추가
--      (3) 행 단위 보안(RLS) 켜기
--
-- 메뉴 테이블이 가리키는 "가게 목록"(지금은 merchants)은 건드리지 않는다.
-- 크롤링이 끝나고 가게 목록을 merchant_crawl_staging 으로 옮길 때는 later/003_switch_to_crawl_staging.sql 을 적용한다.
-- 여러 번 실행해도 안전하다.

-- 1) 제출 당시 가게 이름·주소 (나중에 가게 번호 체계가 바뀌어도 다시 연결할 수 있는 단서)
ALTER TABLE public.menu_submissions
  ADD COLUMN IF NOT EXISTS merchant_name    TEXT,
  ADD COLUMN IF NOT EXISTS merchant_address TEXT;

COMMENT ON COLUMN public.menu_submissions.merchant_name IS
  '제출 당시 가게 이름. merchant_id 체계가 바뀔 때 가게를 다시 찾는 용도';
COMMENT ON COLUMN public.menu_submissions.merchant_address IS
  '제출 당시 가게 도로명 주소. merchant_id 체계가 바뀔 때 가게를 다시 찾는 용도';

-- 2) 가게별 요약 뷰: 식사(meal) 메뉴 기준으로 1만 원 이하 여부를 낸다.
--    Y    : 식사 메뉴 중 1만 원 이하(1만 원 포함)가 하나라도 있음
--    N    : 식사 메뉴는 있는데 전부 1만 원 초과
--    NULL : 식사 메뉴가 없음(= 아직 모름). 뷰에 아예 줄이 없는 가게도 모름이다.
-- 새 열은 기존 열 뒤에 붙인다. (CREATE OR REPLACE VIEW 는 기존 열 순서를 바꿀 수 없다.)
-- security_invoker: 뷰를 통해 RLS 를 우회하지 못하게 한다.
CREATE OR REPLACE VIEW public.merchant_menu_summary
WITH (security_invoker = true) AS
SELECT
  merchant_id,
  MIN(price_won) FILTER (WHERE category = 'meal') AS min_meal_price_won,
  COUNT(*)::int                                   AS menu_count,
  MAX(verified_at)                                AS verified_at,
  CASE
    WHEN COUNT(*) FILTER (WHERE category = 'meal') = 0 THEN NULL
    WHEN MIN(price_won) FILTER (WHERE category = 'meal') <= 10000 THEN 'Y'
    ELSE 'N'
  END                                             AS in_under_10000
FROM public.menus
GROUP BY merchant_id;

-- 3) 행 단위 보안(RLS): 팀의 다른 테이블(reviews, merchant_crawl_staging 등)과 같은 방식이다.
--    백엔드는 DB 에 직접 접속하므로 영향이 없고, 정책이 없으므로 anon 키로는 읽을 수 없다.
ALTER TABLE public.menu_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menus            ENABLE ROW LEVEL SECURITY;
