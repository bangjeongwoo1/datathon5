-- 004: 메뉴판 제보 하나에 사진을 여러 장(최대 5장) 담을 수 있게 한다.
--
-- 추가만 하는 변경이다. 기존 photo_path(한 장) 칸은 그대로 두므로, 이 마이그레이션을 먼저 적용해도
-- 지금 배포된 서버는 그대로 동작한다. 새 서버 코드를 배포하기 "전에" 적용해야 한다.
--   적용: cd backend; node migrate.js   (또는 Supabase SQL Editor 에 붙여넣어 실행)
--
-- photo_paths : 보관 중인 사진 파일 이름 목록(올린 순서). 승인·반려하면 사진을 지우고 NULL 로 바꾼다.
-- photo_path  : 예전 코드와 맞추기 위해 첫 번째 사진 이름을 계속 함께 적는다.
-- 여러 번 실행해도 안전하다.

ALTER TABLE public.menu_submissions
  ADD COLUMN IF NOT EXISTS photo_paths TEXT[];

-- 이미 있는 제보(사진 한 장)는 그 사진을 목록의 첫 장으로 옮겨 적는다.
UPDATE public.menu_submissions
   SET photo_paths = ARRAY[photo_path]
 WHERE photo_path IS NOT NULL
   AND photo_paths IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_submissions_photo_paths_max5') THEN
    ALTER TABLE public.menu_submissions
      ADD CONSTRAINT menu_submissions_photo_paths_max5
      CHECK (photo_paths IS NULL OR cardinality(photo_paths) BETWEEN 1 AND 5);
  END IF;
END $$;
