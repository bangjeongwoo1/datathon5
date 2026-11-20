// 지도·목록에 쓰는 가맹점 조회 쿼리.
// 가게 정보의 메인 테이블은 merchant_crawl_staging 이다. (옛 merchants, merchant_naver_info 는 쓰지 않는다.)
// 이 표의 열 이름(mrhstNm, rdnmadr, …)과 글자로 저장된 좌표를, 화면이 쓰는 이름·형식으로 바꿔서 내려준다.
// 판별불가·주점의심도 데이터 그대로 포함한다. (크롤링으로 다시 갱신할 예정이라 거르는 규칙은 두지 않는다.)

const NUMBER_PATTERN = '^-?[0-9]+(\\.[0-9]+)?$';

// Cuisine(세부 업종) -> 화면의 큰 분류. 아래 목록에 없는 음식 업종은 모두 '음식점'이다.
// Cuisine 이 비어 있으면(판별불가) '미분류'.
const CATEGORY_GROUPS = [
  ['편의점', ['편의점']],
  ['마트·슈퍼', ['슈퍼,마트', '정육점', '과일']],
  ['반찬·식품', ['반찬가게', '떡,한과']],
  [
    '제과·간식',
    [
      '베이커리', '카페,디저트', '카페', '도넛', '케이크전문', '빙수', '아이스크림', '베이글',
      '와플', '찐빵', '핫도그', '브런치카페', '애견카페', '차', '토스트', '샌드위치',
    ],
  ],
  [
    '기타',
    ['신용조합', '펜션', '민박', '기업', '체험여행', '무더위쉼터', '프랜차이즈본사', '새로오픈'],
  ],
];

export const CATEGORY_RULES = CATEGORY_GROUPS;

// 값은 모두 파라미터가 아니라 위 상수에서 오므로 SQL 에 그대로 넣어도 안전하다.
const quote = value => `'${value.replace(/'/g, "''")}'`;

const CATEGORY_SQL = `CASE
        WHEN NULLIF(s."Cuisine", '') IS NULL THEN '미분류'
${CATEGORY_GROUPS.map(
  ([label, cuisines]) =>
    `        WHEN s."Cuisine" IN (${cuisines.map(quote).join(', ')}) THEN ${quote(label)}`
).join('\n')}
        ELSE '음식점'
      END`;

const text = column => `NULLIF(s."${column}", '')`;

// 공공데이터가 번호를 숨긴 행은 000-0000-0000 처럼 0과 하이픈뿐이다. 가짜 번호와 전화 버튼이 뜨지 않도록 "번호 없음"으로 돌려준다.
const PHONE_SQL = `CASE WHEN s."phoneNumber" ~ '^[-0 ]*$' THEN NULL ELSE s."phoneNumber" END`;
const number = column =>
  `CASE WHEN s."${column}" ~ '${NUMBER_PATTERN}' THEN s."${column}"::float8 END`;

/** 지역·검색어·페이지로 조회 쿼리와 값을 만든다. 값은 모두 파라미터($1…)로 전달한다. */
export function merchantListQueries({ region = '', search = '', limit = 100, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (region) {
    params.push(region);
    conditions.push(`s."signguNm" = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`s."mrhstNm" ILIKE $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total
       FROM public.merchant_crawl_staging AS s ${where}`;

  const dataSql = `SELECT
      s.merchant_id,
      s."signguNm" AS region,
      s."mrhstNm" AS name,
      COALESCE(${text('rdnmadr')}, ${text('lnmadr')}) AS address,
      ${number('latitude')} AS latitude,
      ${number('longitude')} AS longitude,
      ${CATEGORY_SQL} AS category,
      ${PHONE_SQL} AS phone,
      ${text('Cuisine')} AS naver_cuisine,
      ${text('네이버기반판별')} AS naver_classification,
      ${text('주소확인')} AS address_check,
      ${text('weekdayOperOpenHhmm')} AS weekday_open,
      ${text('weekdayOperColseHhmm')} AS weekday_close,
      ${text('satOperOperOpenHhmm')} AS saturday_open,
      ${text('satOperCloseHhmm')} AS saturday_close,
      ${text('holidayOperOpenHhmm')} AS holiday_open,
      ${text('holidayCloseOpenHhmm')} AS holiday_close,
      ms.in_under_10000,
      ms.min_meal_price_won,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', menu.name, 'price', menu.price_won
        ) ORDER BY menu.price_won, menu.name)
        FROM public.menus AS menu
        WHERE menu.merchant_id = s.merchant_id AND menu.category = 'meal'
      ), '[]'::jsonb) AS confirmed_meals,
      -- 메뉴 이름 검색용: 승인된 메뉴 이름 전체(식사·사이드·음료·주류). 승인된 메뉴가 없으면 null.
      (
        SELECT array_agg(DISTINCT menu.name ORDER BY menu.name)
        FROM public.menus AS menu
        WHERE menu.merchant_id = s.merchant_id
      ) AS menu_names
   FROM public.merchant_crawl_staging AS s
   LEFT JOIN public.merchant_menu_summary AS ms
     ON ms.merchant_id = s.merchant_id
   ${where}
   ORDER BY length(s.merchant_id), s.merchant_id
   LIMIT $${params.length + 1}
   OFFSET $${params.length + 2}`;

  return {
    countSql,
    countParams: params,
    dataSql,
    dataParams: [...params, limit, offset],
  };
}
