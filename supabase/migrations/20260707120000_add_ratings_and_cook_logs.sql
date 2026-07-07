-- Per-user recipe ratings and cook logs.
--
-- Ratings move from a single recipes.rating column to one row per (recipe, user)
-- so households can see an average plus each member's rating. recipes.rating is
-- kept and repurposed as the cached average so existing sorts keep working.
--
-- Cook logs record that a dish was made on a given day. This is now the only
-- source of "days since last made" / "times made" (previously derived from the
-- meal plan calendar).

create table if not exists recipe_ratings (
  recipe_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  rating int not null check (rating between 1 and 5),
  user_name text,
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);
alter table recipe_ratings enable row level security;

create index if not exists recipe_ratings_recipe_id_idx on recipe_ratings (recipe_id);
create index if not exists recipe_ratings_household_id_idx on recipe_ratings (household_id);

create table if not exists recipe_cook_logs (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  cooked_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, recipe_id, cooked_on)
);
alter table recipe_cook_logs enable row level security;

create index if not exists recipe_cook_logs_recipe_id_idx on recipe_cook_logs (recipe_id);
create index if not exists recipe_cook_logs_household_id_idx on recipe_cook_logs (household_id);
create index if not exists recipe_cook_logs_cooked_on_idx on recipe_cook_logs (cooked_on desc);

-- RLS: own or same household (mirrors recipes/meal_plan_entries)
create policy "Users manage own or household ratings"
  on recipe_ratings for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

create policy "Users manage own or household cook logs"
  on recipe_cook_logs for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );

-- Backfill: seed each recipe owner's existing rating into recipe_ratings.
insert into recipe_ratings (recipe_id, user_id, household_id, rating, updated_at)
select r.id, r.user_id, hm.household_id, r.rating, r.updated_at
from recipes r
left join household_members hm on hm.user_id = r.user_id
where r.rating is not null
on conflict (recipe_id, user_id) do nothing;
