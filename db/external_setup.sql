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
