-- 음식점 구조화 리뷰 기능을 위한 마이그레이션.
-- Supabase SQL Editor(또는 DB 관리자)가 직접 실행해 주세요. 이 저장소의 어떤 코드도
-- 이 파일을 자동으로 실행하지 않습니다.
--
-- 전제: public.merchants(merchant_id text primary key, ...), auth.users(id uuid)가 이미 존재.

-- 긍정/부정 평가 항목 5종 (고정값 -> DB가 유효성 검증)
create type review_tag as enum ('price', 'taste', 'kindness', 'atmosphere', 'portion');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references public.merchants(merchant_id),
  user_id uuid not null references auth.users(id),
  rating numeric(2,1) not null,
  positive_tags review_tag[] not null default '{}',
  negative_tags review_tag[] not null default '{}',
  created_at timestamptz not null default now(),
  -- 하루 1회 제한의 "하루" 기준(KST)을 저장 컬럼으로 고정
  review_date date generated always as ((created_at at time zone 'Asia/Seoul')::date) stored,
  constraint rating_range check (rating between 0.5 and 5.0),
  constraint rating_half_step check (rating * 2 = floor(rating * 2)),
  constraint no_overlap_tags check (not (positive_tags && negative_tags)),
  -- 동시 요청이 와도 Postgres 유니크 제약이 원자적으로 하루 1건만 허용
  constraint one_review_per_day unique (user_id, review_date)
);

create index reviews_merchant_id_idx on public.reviews (merchant_id);
create index reviews_user_id_idx on public.reviews (user_id);

-- user_id/created_at을 클라이언트가 임의로 보내도 무시하고 서버가 강제로 덮어씀.
-- (created_at을 과거로 위조해 review_date를 바꾸면 하루 1회 제한을 우회할 수 있으므로
--  RLS의 WITH CHECK만으로는 부족 -> 트리거로 이중 방어)
create function public.set_review_server_fields()
returns trigger
language plpgsql
security definer
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

create trigger trg_reviews_server_fields
  before insert on public.reviews
  for each row execute function public.set_review_server_fields();

alter table public.reviews enable row level security;

-- 비로그인 포함 누구나 열람 가능
create policy reviews_select_all
  on public.reviews for select
  using (true);

-- 로그인한 사용자만 작성 가능 (user_id는 트리거가 auth.uid()로 강제 대입)
create policy reviews_insert_authenticated
  on public.reviews for insert
  with check (auth.uid() is not null);

-- update/delete 정책을 만들지 않음 = 기본적으로 전부 거부
-- -> 작성자 본인을 포함해 어떤 사용자도 리뷰를 수정/삭제할 수 없음 (요구사항 7, 11)

-- 음식점별 평균 별점 / 리뷰 수 (실데이터 기준, 매 조회마다 정확히 계산)
create view public.merchant_review_summary as
select
  m.merchant_id,
  count(r.id)::int as review_count,
  round(avg(r.rating)::numeric, 2) as avg_rating
from public.merchants m
left join public.reviews r on r.merchant_id = m.merchant_id
group by m.merchant_id;

-- 음식점 x 평가항목 x 긍정/부정 원시 집계 (원시 카운트를 보존, 순점수는 프론트/쿼리에서 계산)
create view public.merchant_tag_counts as
select
  merchant_id,
  tag,
  count(*) filter (where sentiment = 'positive') as positive_count,
  count(*) filter (where sentiment = 'negative') as negative_count
from (
  select merchant_id, unnest(positive_tags) as tag, 'positive' as sentiment from public.reviews
  union all
  select merchant_id, unnest(negative_tags) as tag, 'negative' as sentiment from public.reviews
) t
group by merchant_id, tag;

grant select on public.reviews, public.merchant_review_summary, public.merchant_tag_counts
  to anon, authenticated;
grant insert on public.reviews to authenticated;
grant usage on type public.review_tag to anon, authenticated;
