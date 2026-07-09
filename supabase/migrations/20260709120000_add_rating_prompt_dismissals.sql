-- Tracks which post-cook rating prompts a user has already been shown, so each
-- dish is asked about at most once per cook. Per-user (not household) and synced
-- across the user's own devices — this replaces the previous localStorage-only
-- tracking, which re-asked on every new device.
--
-- A row means "this user has dealt with (rated or dismissed) the rating prompt
-- for this recipe cooked on this day." Two rows are written per interaction
-- (the 1- and 2-days-ago slots) so the dish isn't re-asked for the rest of its
-- prompt window; entries only ever reference past dates, so they never collide
-- with a future cook.

create table if not exists recipe_rating_prompts (
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id text not null,
  cooked_on date not null,
  handled_at timestamptz not null default now(),
  primary key (user_id, recipe_id, cooked_on)
);
alter table recipe_rating_prompts enable row level security;

create index if not exists recipe_rating_prompts_user_id_idx
  on recipe_rating_prompts (user_id);

-- Each user manages only their own prompt history (personal, not household).
create policy "Users manage own rating prompts"
  on recipe_rating_prompts for all
  using (auth.uid() = user_id);
