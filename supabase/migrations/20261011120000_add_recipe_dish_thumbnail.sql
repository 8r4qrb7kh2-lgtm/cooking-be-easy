-- Dish photos are stored inline as full-size base64 data URLs, so listing recipes
-- with `select *` shipped every photo (~11 MB) to every page that shows the
-- library. List views now read a small thumbnail of the first photo instead and
-- leave the full-size photos to the recipe page.
--
-- dish_thumbnail is written by the app whenever a recipe is saved;
-- dish_photo_count lets list views show the photo count without the photos.

alter table recipes
  add column if not exists dish_thumbnail text;

alter table recipes
  add column if not exists dish_photo_count int
  generated always as (coalesce(cardinality(dish_photos), 0)) stored;
