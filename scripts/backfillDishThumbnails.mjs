// One-off backfill for recipes.dish_thumbnail (see the 20261011120000 migration).
// The app keeps the column current on save; this covers recipes saved before it
// existed. Safe to re-run — it only touches recipes with photos and no thumbnail.
//
//   node --env-file=.env.local scripts/backfillDishThumbnails.mjs

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// Keep in sync with DISH_THUMBNAIL_* in lib/storage.ts.
const SIZE = 320; // shorter side, px
const QUALITY = 70;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: pending, error } = await supabase
  .from("recipes")
  .select("id, name")
  .is("dish_thumbnail", null)
  .gt("dish_photo_count", 0);
if (error) throw error;

for (const { id, name } of pending) {
  const { data, error: photoError } = await supabase
    .from("recipes")
    .select("photo:dish_photos->>0")
    .eq("id", id)
    .single();
  if (photoError) throw photoError;

  const base64 = String(data.photo).replace(/^data:[^,]*,/, "");
  const thumbnail = await sharp(Buffer.from(base64, "base64"))
    .rotate()
    .resize(SIZE, SIZE, { fit: "outside", withoutEnlargement: true })
    .jpeg({ quality: QUALITY })
    .toBuffer();

  const { error: updateError } = await supabase
    .from("recipes")
    .update({ dish_thumbnail: `data:image/jpeg;base64,${thumbnail.toString("base64")}` })
    .eq("id", id);
  if (updateError) throw updateError;
  console.log(`${name}: ${Math.round(thumbnail.length / 1024)} KB`);
}

console.log(`Backfilled ${pending.length} recipe(s).`);
