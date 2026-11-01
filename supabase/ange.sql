-- ANGELUXE AI request history and admin-only print cost settings.
create table if not exists public.ange_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_kind text not null check (task_kind in ('text', 'image')),
  prompt text not null check (char_length(prompt) between 8 and 600),
  provider_task_id text not null unique,
  filament_m numeric(10,2),
  time_minutes integer,
  estimated_price numeric(10,2),
  volume_cm3 numeric(10,2),
  stl_path text,
  created_at timestamptz not null default now()
);
create index if not exists ange_generations_user_created_idx on public.ange_generations(user_id, created_at desc);
alter table public.ange_generations enable row level security;
revoke all on public.ange_generations from anon, authenticated;
grant select, insert on public.ange_generations to authenticated;
grant update (filament_m,time_minutes,estimated_price,volume_cm3,stl_path) on public.ange_generations to authenticated;
drop policy if exists "read own ANGELUXE generations" on public.ange_generations;
create policy "read own ANGELUXE generations" on public.ange_generations for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "insert own ANGELUXE generations" on public.ange_generations;
create policy "insert own ANGELUXE generations" on public.ange_generations for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "update own ANGELUXE estimates" on public.ange_generations;
create policy "update own ANGELUXE estimates" on public.ange_generations for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "admin reads all ANGELUXE generations" on public.ange_generations;
create policy "admin reads all ANGELUXE generations" on public.ange_generations for select to authenticated using (private.is_admin());

create table if not exists public.admin_settings (
  id boolean primary key default true check (id = true),
  filament_cost_per_meter numeric(10,4) not null default 0 check (filament_cost_per_meter >= 0),
  machine_cost_per_minute numeric(10,4) not null default 0 check (machine_cost_per_minute >= 0),
  minimum_gross_margin numeric(5,4) not null default 0.40 check (minimum_gross_margin = 0.40),
  costs_configured boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.admin_settings(id) values (true) on conflict (id) do nothing;
alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from anon, authenticated;
grant select, update on public.admin_settings to authenticated;
drop policy if exists "admin reads pricing settings" on public.admin_settings;
create policy "admin reads pricing settings" on public.admin_settings for select to authenticated using (private.is_admin());
drop policy if exists "admin updates pricing settings" on public.admin_settings;
create policy "admin updates pricing settings" on public.admin_settings for update to authenticated using (private.is_admin()) with check (private.is_admin());

create or replace function public.quote_printing(p_filament_m numeric, p_time_minutes integer)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare settings public.admin_settings%rowtype; base_quote numeric; direct_cost numeric;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_filament_m < 0 or p_time_minutes <= 0 then raise exception 'Invalid estimate'; end if;
  select * into settings from public.admin_settings where id = true;
  base_quote := (p_filament_m * 10) + (p_time_minutes * 0.20);
  direct_cost := (p_filament_m * settings.filament_cost_per_meter) + (p_time_minutes * settings.machine_cost_per_minute);
  return round(greatest(base_quote, direct_cost / (1 - settings.minimum_gross_margin)), 2);
end;
$$;
revoke all on function public.quote_printing(numeric, integer) from public, anon;
grant execute on function public.quote_printing(numeric, integer) to authenticated;

alter table public.orders add column if not exists source_generation_id uuid unique references public.ange_generations(id) on delete set null;

