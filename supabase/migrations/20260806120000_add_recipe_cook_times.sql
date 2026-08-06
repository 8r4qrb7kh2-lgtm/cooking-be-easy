-- Per-user "how long did it take to cook?" reports.
--
-- Each user records their own minutes for a dish (asked alongside the post-cook
-- rating prompt, editable from the recipe page). The number the app shows is the
-- average across everyone who reported, so a dish cooked by two people lands
-- between their times.
--
-- One row per (recipe, user), mirroring recipe_ratings.

create table if not exists recipe_cook_times (
  recipe_id text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  minutes int not null check (minutes between 1 and 1440),
  user_name text,
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);
alter table recipe_cook_times enable row level security;

create index if not exists recipe_cook_times_recipe_id_idx on recipe_cook_times (recipe_id);
create index if not exists recipe_cook_times_household_id_idx on recipe_cook_times (household_id);

-- RLS: own or same household (mirrors recipe_ratings)
create policy "Users manage own or household cook times"
  on recipe_cook_times for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );
