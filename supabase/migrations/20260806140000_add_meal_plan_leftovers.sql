-- Leftovers: a meal slot can be filled with an earlier meal's leftovers instead
-- of a dish being cooked fresh. Same recipe, flagged so the planner can badge it
-- and so shopping skips it (the food was already bought for the original meal).
--
-- The existing (owner, plan_date, slot, recipe_id) unique index still applies, so
-- leftovers can't land in a slot that already holds the same dish.

alter table meal_plan_entries
  add column if not exists is_leftovers boolean not null default false;
