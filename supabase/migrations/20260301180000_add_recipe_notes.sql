alter table if exists recipes
  add column if not exists notes text not null default '';
