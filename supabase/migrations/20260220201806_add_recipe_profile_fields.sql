alter table if exists recipes
  add column if not exists rating int,
  add column if not exists servings_yielded numeric(6,2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'recipes_rating_check'
      and conrelid = 'recipes'::regclass
  ) then
    alter table recipes
      add constraint recipes_rating_check
      check (rating between 1 and 5);
  end if;
end $$;
