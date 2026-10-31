-- Run in Supabase SQL Editor after creating the project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_bytes bigint not null check (file_bytes > 0 and file_bytes <= 52428800),
  filament_m numeric(10,2) not null check (filament_m >= 0),
  time_minutes integer not null check (time_minutes > 0),
  estimated_price numeric(10,2) not null check (estimated_price >= 0),
  volume_cm3 numeric(10,2),
  material text not null default 'PLA',
  status text not null default 'pending' check (status in ('pending','approved','printing','done')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,email,first_name,last_name,phone)
  values (new.id,new.email,new.raw_user_meta_data->>'first_name',new.raw_user_meta_data->>'last_name',new.raw_user_meta_data->>'phone')
  on conflict (id) do update set email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,phone=excluded.phone;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users for each row execute procedure public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
-- Keep the SECURITY DEFINER helper outside the exposed API schema. It answers
-- only for the active authenticated user and is callable only by signed-in users.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin');
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles for select to authenticated using (id=(select auth.uid()) or private.is_admin());
drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()) and role='customer');
drop policy if exists "orders insert own" on public.orders;
create policy "orders insert own" on public.orders for insert to authenticated with check (user_id=(select auth.uid()));
drop policy if exists "orders read own or admin" on public.orders;
create policy "orders read own or admin" on public.orders for select to authenticated using (user_id=(select auth.uid()) or private.is_admin());
drop policy if exists "orders update admin" on public.orders;
create policy "orders update admin" on public.orders for update to authenticated using (private.is_admin()) with check (private.is_admin());
create index if not exists orders_user_id_created_at_idx on public.orders(user_id,created_at);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('stl-files','stl-files',false,52428800,array['model/stl','application/sla','application/octet-stream'])
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "upload own stl" on storage.objects;
create policy "upload own stl" on storage.objects for insert to authenticated with check (bucket_id='stl-files' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "read own stl or admin" on storage.objects;
create policy "read own stl or admin" on storage.objects for select to authenticated using (bucket_id='stl-files' and ((storage.foldername(name))[1]=(select auth.uid())::text or private.is_admin()));

-- Create your normal customer account first, then promote that account:
-- update public.profiles set role='admin' where email='YOUR_ADMIN_EMAIL';
