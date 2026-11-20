-- Read-only diagnosis for the team DB. No schema or data changes.
-- Run with the team's existing authorized DB connection.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('merchant_crawl_staging', 'merchants', 'merchant_naver_info')
  AND (column_name ILIKE '%phone%' OR column_name ILIKE '%tel%'
    OR column_name LIKE '%전화%' OR column_name LIKE '%연락%')
ORDER BY table_name, ordinal_position;

-- These are the source table/column used by the CURRENT main API.
-- Count usable-looking values without printing individual phone numbers.
SELECT "signguNm" AS region,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM("phoneNumber"), '') IS NOT NULL) AS populated_phone_rows,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM("phoneNumber"), '') IS NOT NULL
      AND "phoneNumber" !~ '^[-0 ]*$'
  ) AS non_placeholder_phone_rows
FROM public.merchant_crawl_staging
GROUP BY "signguNm"
ORDER BY "signguNm";
