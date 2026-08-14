-- Cooking mode keeps time on itself.
--
-- Every visit to a dish's cooking-mode screen writes one row here: when the
-- screen opened, and when it was last still open. The post-cook "how long did
-- it take?" prompt then answers itself — first open to last close on the day
-- the dish was logged — instead of making the user recall it.
--
-- ended_at starts equal to started_at and is refreshed on a heartbeat while the
-- screen is open, so a session survives a tab being closed outright (nothing
-- gets to run on the way out); it is never null.
--
-- Per-user, not household: this measures how long *this* person had the recipe
-- open, which is what their own reported cook time is meant to say.

create table if not exists cooking_mode_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  recipe_id text not null,
  -- Local calendar day the session started on, matching recipe_cook_logs, so
  -- the estimate lines up with the cook the prompt is asking about.
  cooked_on date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz not null default now()
);
alter table cooking_mode_sessions enable row level security;

-- The one read: this user's sessions for one dish on one day.
create index if not exists cooking_mode_sessions_user_recipe_day_idx
  on cooking_mode_sessions (user_id, recipe_id, cooked_on);

-- Each user manages only their own sessions (personal, not household).
create policy "Users manage own cooking mode sessions"
  on cooking_mode_sessions for all
  using (auth.uid() = user_id);
