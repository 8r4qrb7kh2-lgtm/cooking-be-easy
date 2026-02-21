-- Run this in your Supabase SQL Editor to set up households + fix missing tables
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS throughout)

-- 1. Household tables (must exist before tables that reference them)

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid references households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
alter table household_members enable row level security;

create table if not exists household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_by uuid references auth.users(id) on delete cascade not null,
  used_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
alter table household_invites enable row level security;

-- 2. Core app tables (create if missing, add household_id if needed)

create table if not exists recipes (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  rating int check (rating between 1 and 5),
  servings_yielded numeric(6,2),
  dish_photos text[] not null default '{}',
  ingredient_photo text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table recipes enable row level security;
-- Add rating + servings_yielded if table already existed without them
alter table recipes add column if not exists rating int;
alter table recipes add column if not exists servings_yielded numeric(6,2);
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recipes_rating_check'
      and conrelid = 'recipes'::regclass
  ) then
    alter table recipes add constraint recipes_rating_check check (rating between 1 and 5);
  end if;
end $$;

create table if not exists weekly_plans (
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id text not null,
  household_id uuid references households(id),
  primary key (user_id, recipe_id)
);
alter table weekly_plans enable row level security;
-- Add household_id if table already existed without it
alter table weekly_plans add column if not exists household_id uuid references households(id);

create table if not exists shopping_list (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  quantity text not null default '',
  unit text not null default '',
  section text not null default 'Other',
  recipe_ids jsonb not null default '[]',
  recipe_names jsonb not null default '[]',
  checked boolean not null default false,
  household_id uuid references households(id)
);
alter table shopping_list enable row level security;
-- Add household_id if table already existed without it
alter table shopping_list add column if not exists household_id uuid references households(id);

-- 3. Helper functions (security definer = bypasses RLS, avoids infinite recursion)

create or replace function get_my_household_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(household_id), array[]::uuid[])
  from household_members
  where user_id = auth.uid()
$$;

create or replace function get_household_user_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(hm2.user_id), array[]::uuid[])
  from household_members hm1
  join household_members hm2 on hm1.household_id = hm2.household_id
  where hm1.user_id = auth.uid()
$$;

-- 4. RLS policies (drop old ones first to avoid conflicts)

drop policy if exists "Users manage own recipes" on recipes;
drop policy if exists "Users manage own or household recipes" on recipes;
create policy "Users manage own or household recipes" on recipes for all
  using (auth.uid() = user_id OR user_id = ANY(get_household_user_ids()));

drop policy if exists "Users manage own plans" on weekly_plans;
drop policy if exists "Users manage own or household plans" on weekly_plans;
create policy "Users manage own or household plans" on weekly_plans for all
  using (
    auth.uid() = user_id
    OR household_id = ANY(get_my_household_ids())
  );

drop policy if exists "Users manage own list" on shopping_list;
drop policy if exists "Users manage own or household list" on shopping_list;
create policy "Users manage own or household list" on shopping_list for all
  using (
    auth.uid() = user_id
    OR household_id = ANY(get_my_household_ids())
  );

drop policy if exists "Members see own household" on household_members;
create policy "Members see own household" on household_members for select
  using (household_id = ANY(get_my_household_ids()));

drop policy if exists "Anyone can read invites" on household_invites;
drop policy if exists "Creators manage invites" on household_invites;
create policy "Anyone can read invites" on household_invites for select using (true);
create policy "Creators manage invites" on household_invites for all using (created_by = auth.uid());
