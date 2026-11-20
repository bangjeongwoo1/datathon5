-- 메뉴판 OCR 제보 기능용 테이블
--   menu_submissions : 제보(사진 1장) 단위. OCR 결과를 담고 관리자 승인을 기다린다.
--   menus            : 관리자가 승인한 확정 메뉴. 지도와 "만원 이하" 필터는 이 테이블만 본다.
--   merchant_menu_summary : 가맹점별 "한 끼(meal) 최저가" 요약 (필터용)

CREATE TABLE IF NOT EXISTS public.menu_submissions (
  submission_id   BIGSERIAL PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES public.merchants (merchant_id),

  -- 로그인 기능이 붙기 전에는 비어 있을 수 있다.
  submitted_by    TEXT,
  submitted_email TEXT,

  -- 승인·반려 후 삭제하는 원본 사진의 비공개 저장 경로
  photo_path      TEXT,

  -- OCR 결과: [{ name, price_won, price_text, category, status }]
  items           JSONB NOT NULL,
  -- 범위 밖·해석 불가로 걸러진 항목
  rejected        JSONB NOT NULL DEFAULT '[]'::jsonb,
  model           TEXT,
  has_uncertain   BOOLEAN NOT NULL DEFAULT FALSE,

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_submissions_queue
  ON public.menu_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_menu_submissions_merchant
  ON public.menu_submissions (merchant_id);

CREATE TABLE IF NOT EXISTS public.menus (
  menu_id       BIGSERIAL PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES public.merchants (merchant_id) ON DELETE CASCADE,
  submission_id BIGINT REFERENCES public.menu_submissions (submission_id) ON DELETE SET NULL,

  name          TEXT NOT NULL,
  price_won     INTEGER NOT NULL CHECK (price_won BETWEEN 500 AND 100000),
  -- meal: 한 끼 식사, side: 사이드, drink: 음료, alcohol: 주류
  category      TEXT NOT NULL CHECK (category IN ('meal', 'side', 'drink', 'alcohol')),

  verified_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menus_merchant ON public.menus (merchant_id);

-- 가맹점별 요약. 필터 조건: min_meal_price_won <= 10000
CREATE OR REPLACE VIEW public.merchant_menu_summary AS
SELECT
  merchant_id,
  MIN(price_won) FILTER (WHERE category = 'meal') AS min_meal_price_won,
  COUNT(*)::int                                   AS menu_count,
  MAX(verified_at)                                AS verified_at
FROM public.menus
GROUP BY merchant_id;
