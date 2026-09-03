create table if not exists public.user_lessons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  package jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_lessons to authenticated;
grant all on public.user_lessons to service_role;
alter table public.user_lessons enable row level security;
drop policy if exists "Users manage own lessons" on public.user_lessons;
create policy "Users manage own lessons" on public.user_lessons for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists user_lessons_user_idx on public.user_lessons (user_id, updated_at desc);

create table if not exists public.lesson_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  title text not null,
  package jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.lesson_shares to authenticated;
grant all on public.lesson_shares to service_role;
alter table public.lesson_shares enable row level security;
drop policy if exists "Users manage own shares" on public.lesson_shares;
create policy "Users manage own shares" on public.lesson_shares for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists lesson_shares_user_idx on public.lesson_shares (user_id, created_at desc);

create table if not exists public.lesson_share_results (
  id uuid primary key default gen_random_uuid(),
  share_token text not null,
  student_name text not null,
  score integer not null default 0,
  total integer not null default 0,
  answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lesson_share_results_token_idx on public.lesson_share_results (share_token, created_at desc);
grant insert on public.lesson_share_results to anon;
grant select, insert, delete on public.lesson_share_results to authenticated;
grant all on public.lesson_share_results to service_role;
alter table public.lesson_share_results enable row level security;

drop policy if exists "Anyone can submit a result" on public.lesson_share_results;
create policy "Anyone can submit a result" on public.lesson_share_results for insert to anon, authenticated
  with check (
    char_length(student_name) between 1 and 60
    and exists (select 1 from public.lesson_shares s where s.token = share_token)
  );

drop policy if exists "Share owners can read results" on public.lesson_share_results;
create policy "Share owners can read results" on public.lesson_share_results for select to authenticated
  using (exists (select 1 from public.lesson_shares s where s.token = share_token and s.user_id = auth.uid()));

drop policy if exists "Share owners can delete results" on public.lesson_share_results;
create policy "Share owners can delete results" on public.lesson_share_results for delete to authenticated
  using (exists (select 1 from public.lesson_shares s where s.token = share_token and s.user_id = auth.uid()));

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists user_lessons_updated_at on public.user_lessons;
create trigger user_lessons_updated_at before update on public.user_lessons
  for each row execute function public.set_updated_at();

drop trigger if exists lesson_shares_updated_at on public.lesson_shares;
create trigger lesson_shares_updated_at before update on public.lesson_shares
  for each row execute function public.set_updated_at();