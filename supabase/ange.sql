-- Ange AI generation history. Apply once in Supabase SQL Editor.
create table if not exists public.ange_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_kind text not null check (task_kind in ('text', 'image')),
  prompt text not null check (char_length(prompt) between 8 and 600),
  provider_task_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists ange_generations_user_created_idx
  on public.ange_generations(user_id, created_at desc);

alter table public.ange_generations enable row level security;
revoke all on public.ange_generations from anon, authenticated;
grant select, insert on public.ange_generations to authenticated;

drop policy if exists "read own Ange generations" on public.ange_generations;
create policy "read own Ange generations"
  on public.ange_generations for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "insert own Ange generations" on public.ange_generations;
create policy "insert own Ange generations"
  on public.ange_generations for insert to authenticated
  with check (user_id = (select auth.uid()));

