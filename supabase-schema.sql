-- Run this in your Supabase SQL Editor to set up the database

-- Households (shared recipe libraries) — must be created first since other tables reference it
create table households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Household members
create table household_members (
  household_id uuid references households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
alter table household_members enable row level security;

-- Household invites
create table household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade not null,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_by uuid references auth.users(id) on delete cascade not null,
  used_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
alter table household_invites enable row level security;

-- Recipes table
create table recipes (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  notes text not null default '',
  rating int check (rating between 1 and 5),
  servings_yielded numeric(6,2),
  dish_photos text[] not null default '{}',
  ingredient_photo text,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table recipes enable row level security;

-- Weekly plan
create table weekly_plans (
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id text not null,
  household_id uuid references households(id),
  primary key (user_id, recipe_id)
);
alter table weekly_plans enable row level security;

-- Per-user recipe ratings (recipes.rating caches the average)
create table recipe_ratings (
  recipe_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  rating int not null check (rating between 1 and 5),
  user_name text,
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);
alter table recipe_ratings enable row level security;

-- Cook logs: a dish was made on a day (source of "days since last made")
create table recipe_cook_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  cooked_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id, cooked_on)
);
alter table recipe_cook_logs enable row level security;

-- Rating prompts: which post-cook "how was it?" prompts a user has handled
-- (rated or dismissed), so each dish is asked about at most once per cook.
-- Per-user (personal, not household) so it syncs across the user's devices.
create table recipe_rating_prompts (
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id text not null,
  cooked_on date not null,
  handled_at timestamptz not null default now(),
  primary key (user_id, recipe_id, cooked_on)
);
alter table recipe_rating_prompts enable row level security;

-- Meal planner: one recipe planned into one meal slot (lunch/dinner) on one date
create table meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  recipe_id text not null,
  plan_date date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  created_at timestamptz not null default now()
);
alter table meal_plan_entries enable row level security;

create unique index meal_plan_entries_owner_date_slot_recipe_key
  on meal_plan_entries ((coalesce(household_id::text, user_id::text)), plan_date, slot, recipe_id);

-- Shopping list
create table shopping_list (
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

-- Grocery receipts (price library for recipe pricing)
create table receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  store_name text,
  store_location text,
  purchase_date date,
  subtotal numeric(10,2),
  total numeric(10,2),
  currency_code text not null default 'USD',
  image_base64 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table receipts enable row level security;

create table receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references receipts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  raw_label text not null,
  normalized_name text not null,
  brand text,
  section text,
  quantity numeric(12,3),
  unit text,
  package_size_text text,
  unit_price numeric(10,2),
  total_price numeric(10,2) not null,
  currency_code text not null default 'USD',
  purchased_at date,
  store_name text,
  confidence numeric(3,2),
  created_at timestamptz not null default now()
);
alter table receipt_items enable row level security;

-- Helper function: returns all user IDs in the caller's household
create or replace function get_household_user_ids()
returns uuid[] language sql security definer stable as $$
  select coalesce(array_agg(hm2.user_id), array[]::uuid[])
  from household_members hm1
  join household_members hm2 on hm1.household_id = hm2.household_id
  where hm1.user_id = auth.uid()
$$;

-- RLS policies

-- Recipes: own or household member's
create policy "Users manage own or household recipes" on recipes for all
  using (auth.uid() = user_id OR user_id = ANY(get_household_user_ids()));

-- Weekly plans: own or same household
create policy "Users manage own or household plans" on weekly_plans for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Recipe ratings: own or same household
create policy "Users manage own or household ratings" on recipe_ratings for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Cook logs: own or same household
create policy "Users manage own or household cook logs" on recipe_cook_logs for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Rating prompts: personal, own rows only
create policy "Users manage own rating prompts" on recipe_rating_prompts for all
  using (auth.uid() = user_id);

-- Meal plan entries: own or same household
create policy "Users manage own or household meal plan entries" on meal_plan_entries for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Shopping list: own or same household
create policy "Users manage own or household list" on shopping_list for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Receipts: own or same household
create policy "Users manage own or household receipts" on receipts for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Receipt items: own or same household
create policy "Users manage own or household receipt items" on receipt_items for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Household members: can see own household
create policy "Members see own household" on household_members for select
  using (household_id in (select household_id from household_members where user_id = auth.uid()));

-- Household invites: anyone can read (to view/accept), creator can manage
create policy "Anyone can read invites" on household_invites for select using (true);
create policy "Creators manage invites" on household_invites for all using (created_by = auth.uid());
