-- Meal planner: a weekly calendar of planned lunches and dinners.
-- Each row is one recipe planned into one meal slot on one date. Past entries
-- double as the cooking history that powers "days since last made".

create table if not exists meal_plan_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  household_id uuid references households(id),
  recipe_id text not null,
  plan_date date not null,
  slot text not null check (slot in ('lunch', 'dinner')),
  created_at timestamptz not null default now()
);
alter table meal_plan_entries enable row level security;

create index if not exists meal_plan_entries_user_id_idx on meal_plan_entries (user_id);
create index if not exists meal_plan_entries_household_id_idx on meal_plan_entries (household_id);
create index if not exists meal_plan_entries_plan_date_idx on meal_plan_entries (plan_date desc);

-- A recipe appears at most once per owner/date/slot (owner = household when set, else user)
create unique index if not exists meal_plan_entries_owner_date_slot_recipe_key
  on meal_plan_entries ((coalesce(household_id::text, user_id::text)), plan_date, slot, recipe_id);

create policy "Users manage own or household meal plan entries"
  on meal_plan_entries for all
  using (
    auth.uid() = user_id
    OR household_id IN (select household_id from household_members where user_id = auth.uid())
  );
