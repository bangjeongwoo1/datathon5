import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_RULES, merchantListQueries } from './merchantList.js';

test('가게 목록은 메인 테이블 merchant_crawl_staging 만 읽는다', () => {
  const { countSql, dataSql } = merchantListQueries();
  for (const sql of [countSql, dataSql]) {
    assert.match(sql, /FROM public\.merchant_crawl_staging AS s/);
    assert.doesNotMatch(sql, /public\.merchants\b/);
    assert.doesNotMatch(sql, /merchant_naver_info/);
  }
});

test('조건이 없으면 전체, 지역·검색어는 파라미터($1…)로만 전달한다', () => {
  const none = merchantListQueries({ limit: 50, offset: 100 });
  assert.deepEqual(none.countParams, []);
  assert.deepEqual(none.dataParams, [50, 100]);
  assert.doesNotMatch(none.countSql, /WHERE/);
  assert.match(none.dataSql, /LIMIT \$1\s+OFFSET \$2/);

  const both = merchantListQueries({ region: '춘천시', search: "윤'; DROP TABLE x;--", limit: 10, offset: 0 });
  assert.deepEqual(both.countParams, ['춘천시', "%윤'; DROP TABLE x;--%"]);
  assert.deepEqual(both.dataParams, ['춘천시', "%윤'; DROP TABLE x;--%", 10, 0]);
  assert.match(both.countSql, /s\."signguNm" = \$1 AND s\."mrhstNm" ILIKE \$2/);
  assert.match(both.dataSql, /LIMIT \$3\s+OFFSET \$4/);
  assert.ok(!both.dataSql.includes('DROP TABLE'), '검색어가 SQL 문장에 들어가면 안 된다');
});

test('화면이 쓰는 이름으로 내려준다(지역·이름·주소·영업시간·공휴일)', () => {
  const { dataSql } = merchantListQueries();
  for (const alias of [
    'region', 'name', 'address', 'latitude', 'longitude', 'category', 'phone',
    'naver_cuisine', 'naver_classification', 'weekday_open', 'weekday_close',
    'saturday_open', 'saturday_close', 'holiday_open', 'holiday_close', 'confirmed_meals',
  ]) {
    assert.match(dataSql, new RegExp(`AS ${alias}\\b`), alias);
  }
  // 만원 이하 판정은 뷰의 열 이름 그대로 내려준다.
  assert.match(dataSql, /ms\.in_under_10000,\s+ms\.min_meal_price_won,/);
  assert.doesNotMatch(dataSql, /sunday/);
});

test('글자로 저장된 좌표는 숫자일 때만 숫자로 바꾼다(이상한 값이 있어도 조회가 깨지지 않는다)', () => {
  const { dataSql } = merchantListQueries();
  assert.match(dataSql, /CASE WHEN s\."latitude" ~ '[^']+' THEN s\."latitude"::float8 END AS latitude/);
  assert.match(dataSql, /CASE WHEN s\."longitude" ~ '[^']+' THEN s\."longitude"::float8 END AS longitude/);
});

test('0과 하이픈뿐인 가짜 전화번호는 "번호 없음"으로 내려준다', () => {
  const { dataSql } = merchantListQueries();
  assert.match(dataSql, /CASE WHEN s\."phoneNumber" ~ '\^\[-0 \]\*\$' THEN NULL ELSE s\."phoneNumber" END AS phone/);
});

test('정렬은 번호 순서(숫자 길이 → 글자)라 숫자로 바꾸다 오류가 나지 않는다', () => {
  assert.match(merchantListQueries().dataSql, /ORDER BY length\(s\.merchant_id\), s\.merchant_id/);
});

test('승인된 메뉴 요약과 확정 식사 메뉴는 staging 번호로 연결한다', () => {
  const { dataSql } = merchantListQueries();
  assert.match(dataSql, /LEFT JOIN public\.merchant_menu_summary AS ms\s+ON ms\.merchant_id = s\.merchant_id/);
  assert.match(dataSql, /menu\.merchant_id = s\.merchant_id AND menu\.category = 'meal'/);
});

test('업종 분류: 규칙에 없는 음식 업종은 음식점, 비어 있으면(판별불가) 미분류', () => {
  const { dataSql } = merchantListQueries();
  assert.match(dataSql, /WHEN NULLIF\(s\."Cuisine", ''\) IS NULL THEN '미분류'/);
  assert.match(dataSql, /ELSE '음식점'/);

  const labels = Object.fromEntries(CATEGORY_RULES);
  assert.ok(labels['편의점'].includes('편의점'));
  assert.ok(labels['마트·슈퍼'].includes('슈퍼,마트'));
  assert.ok(labels['제과·간식'].includes('베이커리'));
  assert.ok(labels['기타'].includes('펜션'));
  // 같은 업종이 두 분류에 들어가면 먼저 나온 쪽이 이기므로 겹침을 막는다.
  const all = CATEGORY_RULES.flatMap(([, list]) => list);
  assert.equal(new Set(all).size, all.length, '업종이 두 분류에 중복되어 있습니다');
  for (const cuisine of ['한식', '중식당', '치킨,닭강정', '닭갈비']) {
    assert.ok(!all.includes(cuisine), `${cuisine} 은 음식점으로 남아야 합니다`);
  }
});
