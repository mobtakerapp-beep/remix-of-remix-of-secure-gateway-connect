-- Run this ONCE in the SQL editor of the external project
-- (sajkxtqcaiubmtamenke). It creates every table the app needs and
-- registers the admin serial + gift code.

-- 1) Roles ------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'moderator', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
drop policy if exists "Users read own roles" on public.user_roles;
create policy "Users read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- 2) Profiles ---------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  teacher_name text not null default '',
  school text not null default '',
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- 3) Subscriptions ----------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  expires_at timestamptz,
  generations_used integer not null default 0,
  reset_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
grant select, insert, update on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;
alter table public.subscriptions enable row level security;
drop policy if exists "Users read own subscription" on public.subscriptions;
create policy "Users read own subscription" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own subscription" on public.subscriptions;
create policy "Users insert own subscription" on public.subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own subscription" on public.subscriptions;
create policy "Users update own subscription" on public.subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4) Activation codes + redemptions ----------------------------------------
create table if not exists public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan text not null default 'monthly',
  duration_days integer not null default 30,
  max_uses integer not null default 1,
  used_count integer not null default 0,
  note text,
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant all on public.activation_codes to service_role;
grant select, insert, update on public.activation_codes to authenticated;
alter table public.activation_codes enable row level security;
drop policy if exists "Admins manage codes" on public.activation_codes;
create policy "Admins manage codes" on public.activation_codes
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create table if not exists public.code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.activation_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text,
  created_at timestamptz not null default now(),
  unique (code_id, user_id)
);
grant select, insert on public.code_redemptions to authenticated;
grant all on public.code_redemptions to service_role;
alter table public.code_redemptions enable row level security;
drop policy if exists "Users read own redemptions" on public.code_redemptions;
create policy "Users read own redemptions" on public.code_redemptions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own redemptions" on public.code_redemptions;
create policy "Users insert own redemptions" on public.code_redemptions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Admins read all redemptions" on public.code_redemptions;
create policy "Admins read all redemptions" on public.code_redemptions
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- 5) AI usage log -----------------------------------------------------------
create table if not exists public.ai_generation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'lesson',
  created_at timestamptz not null default now()
);
grant select, insert on public.ai_generation_log to authenticated;
grant all on public.ai_generation_log to service_role;
alter table public.ai_generation_log enable row level security;
drop policy if exists "Users read own generation log" on public.ai_generation_log;
create policy "Users read own generation log" on public.ai_generation_log
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own generation log" on public.ai_generation_log;
create policy "Users insert own generation log" on public.ai_generation_log
  for insert to authenticated with check (auth.uid() = user_id);

create or replace function public.count_generations_today(_user_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.ai_generation_log
  where user_id = _user_id and created_at >= date_trunc('day', now())
$$;

-- 6) Bootstrap on signup ----------------------------------------------------
create or replace function public.bootstrap_account(_user_id uuid, _teacher_name text default '', _school text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, teacher_name, school)
  values (_user_id, coalesce(_teacher_name, ''), coalesce(_school, ''))
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan, status)
  values (_user_id, 'free', 'active')
  on conflict (user_id) do nothing;
end; $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bootstrap_account(
    new.id,
    coalesce(new.raw_user_meta_data->>'teacher_name', ''),
    coalesce(new.raw_user_meta_data->>'school', '')
  );
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 7) Admin serial + gift code ----------------------------------------------
insert into public.activation_codes (code, plan, duration_days, max_uses, note, active)
values
  ('UUXZ@272', 'yearly', 36500, 1000, 'Owner serial', true),
  ('PVBZ-L7GK-Z67H', 'monthly', 8, 30, 'Gift code', true)
on conflict (code) do update set active = true;

-- 8) Saved lessons, shares, and student results -----------------------------
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

-- 9) Preserve original serials / admin from the old database ----------------
insert into public.activation_codes (id, code, plan, duration_days, max_uses, used_count, note, active, created_at)
values
  ('9e188386-1d26-4fa2-93d3-5f385ff11e14','PVBZ-L7GK-Z67H','monthly',8,30,0,'هدية 8 أيام',true,'2026-09-02 19:35:05.111447+00'),
  ('7542c050-3e54-4a45-8868-2dd1cc7d9c5d','UUXZ@272','yearly',36500,1000,0,'سيريال الأدمن',true,'2026-09-02 19:35:05.111447+00')
on conflict (code) do update
  set plan = excluded.plan, duration_days = excluded.duration_days,
      max_uses = excluded.max_uses, note = excluded.note, active = true;

-- Owner admin role (only applies once that auth user exists in the new project)
insert into public.user_roles (id, user_id, role)
select '025dc5b6-3951-431b-b78e-76bb9bca899b','743baa5a-c669-4a40-b020-a5ae1a09b877','admin'::app_role
where exists (select 1 from auth.users where id = '743baa5a-c669-4a40-b020-a5ae1a09b877')
on conflict (user_id, role) do nothing;
