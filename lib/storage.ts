import { Recipe, ShoppingListItem } from "./types";
import { getSupabase } from "./supabase";
import { getHouseholdId, getUserId } from "./session";
import { normalizeRecipeSteps } from "./recipeSteps";

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// Dish photos are full-size base64 data URLs stored on the recipe row, so list
// views read everything except them and show `dish_thumbnail` instead.
const RECIPE_SUMMARY_COLUMNS =
  "id,name,ingredients,steps,notes,rating,servings_yielded,dish_thumbnail,dish_photo_count,source_url,created_at,updated_at";

// Shorter side of the thumbnail, in px. Keep in sync with
// scripts/backfillDishThumbnails.mjs.
const DISH_THUMBNAIL_SIZE = 320;
const DISH_THUMBNAIL_QUALITY = 0.7;

let lastThumbnail: { photo: string; thumbnail: string } | null = null;

async function makeDishThumbnail(photo: string | undefined): Promise<string | null> {
  if (!photo || typeof document === "undefined") return null;
  // Auto-save calls this on every edit; the first photo rarely changes.
  if (lastThumbnail?.photo === photo) return lastThumbnail.thumbnail;

  try {
    const image = new Image();
    image.src = photo;
    await image.decode();
    const scale = Math.min(
      1,
      DISH_THUMBNAIL_SIZE / Math.min(image.naturalWidth, image.naturalHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/jpeg", DISH_THUMBNAIL_QUALITY);
    lastThumbnail = { photo, thumbnail };
    return thumbnail;
  } catch {
    // Fall back to the photo itself so the recipe still has a list image.
    return photo;
  }
}

// The recipe list is needed by nearly every page, so it's kept for a short
// while to make moving between tabs instant. Local writes drop it; the expiry
// bounds how stale a household member's edits can look.
const RECIPES_CACHE_MS = 60 * 1000;
let recipesCache: {
  userId: string;
  loadedAt: number;
  recipes: Promise<Recipe[]>;
} | null = null;

export function clearRecipesCache() {
  recipesCache = null;
}

function collectStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseRecipeStepsField(value: unknown): {
  sourceSteps: string[];
  steps: string[];
  normalizedStepsChanged: boolean;
} {
  if (Array.isArray(value)) {
    const originalSteps = collectStringArray(value);
    const normalizedSteps = normalizeRecipeSteps(originalSteps);
    const normalizedStepsChanged =
      normalizedSteps.length !== originalSteps.length ||
      normalizedSteps.some((step, index) => step !== originalSteps[index]);

    return {
      sourceSteps: normalizedSteps,
      steps: normalizedSteps,
      normalizedStepsChanged,
    };
  }

  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const originalSourceSteps = collectStringArray(candidate.source);
    const originalCookingSteps = collectStringArray(candidate.cooking);

    const normalizedSourceSteps = normalizeRecipeSteps(originalSourceSteps);
    const normalizedCookingSteps = normalizeRecipeSteps(
      originalCookingSteps.length > 0 ? originalCookingSteps : originalSourceSteps
    );

    const normalizedStepsChanged =
      normalizedSourceSteps.length !== originalSourceSteps.length ||
      normalizedSourceSteps.some((step, index) => step !== originalSourceSteps[index]) ||
      normalizedCookingSteps.length !== originalCookingSteps.length ||
      normalizedCookingSteps.some((step, index) => step !== originalCookingSteps[index]) ||
      originalCookingSteps.length === 0;

    return {
      sourceSteps: normalizedSourceSteps,
      steps: normalizedCookingSteps,
      normalizedStepsChanged,
    };
  }

  return {
    sourceSteps: [],
    steps: [],
    normalizedStepsChanged: false,
  };
}

function serializeRecipeSteps(recipe: Pick<Recipe, "sourceSteps" | "steps">) {
  const normalizedSourceSteps = normalizeRecipeSteps(
    Array.isArray(recipe.sourceSteps) ? recipe.sourceSteps : recipe.steps
  );
  const normalizedCookingSteps = normalizeRecipeSteps(recipe.steps);

  return {
    source: normalizedSourceSteps,
    cooking:
      normalizedCookingSteps.length > 0 ? normalizedCookingSteps : normalizedSourceSteps,
  };
}

function mapRecipeRow(row: any): {
  recipe: Recipe;
  normalizedStepsChanged: boolean;
} {
  const parsedSteps = parseRecipeStepsField(row.steps);
  // Summary rows carry only the thumbnail of the first photo.
  const isSummary = row.dish_photos === undefined;
  const dishPhotos: string[] = isSummary
    ? row.dish_thumbnail
      ? [row.dish_thumbnail]
      : []
    : row.dish_photos || [];

  return {
    recipe: {
      id: row.id,
      name: row.name,
      ingredients: row.ingredients as Recipe["ingredients"],
      sourceSteps: parsedSteps.sourceSteps,
      steps: parsedSteps.steps,
      notes: typeof row.notes === "string" ? row.notes : "",
      rating: parseOptionalNumber(row.rating),
      servingsYielded: parseOptionalNumber(row.servings_yielded),
      dishPhotos,
      dishPhotoCount: isSummary ? row.dish_photo_count ?? dishPhotos.length : dishPhotos.length,
      ...(isSummary ? { isSummary: true as const } : {}),
      ingredientPhoto: row.ingredient_photo || undefined,
      sourceUrl: row.source_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    normalizedStepsChanged: parsedSteps.normalizedStepsChanged,
  };
}

// Every recipe, without full-size photos: `dishPhotos` holds just a thumbnail of
// the first one. Use getRecipe() for the complete recipe.
export async function getRecipes(): Promise<Recipe[]> {
  const userId = await getUserId();
  const cached = recipesCache;
  if (
    cached &&
    cached.userId === userId &&
    Date.now() - cached.loadedAt < RECIPES_CACHE_MS
  ) {
    return [...(await cached.recipes)];
  }

  const recipes = loadRecipes();
  const entry = { userId, loadedAt: Date.now(), recipes };
  recipesCache = entry;
  try {
    return [...(await recipes)];
  } catch (error) {
    if (recipesCache === entry) clearRecipesCache();
    throw error;
  }
}

async function loadRecipes(): Promise<Recipe[]> {
  const supabase = getSupabase();
  // RLS handles filtering: returns own recipes + household members' recipes
  const { data, error } = await supabase
    .from("recipes")
    .select(RECIPE_SUMMARY_COLUMNS)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const mapped = (data || []).map((row) => mapRecipeRow(row));

  const normalizeWrites = mapped
    .filter((item) => item.normalizedStepsChanged)
    .map((item) =>
      supabase
        .from("recipes")
        .update({
          steps: serializeRecipeSteps(item.recipe),
          updated_at: item.recipe.updatedAt,
        })
        .eq("id", item.recipe.id)
    );

  if (normalizeWrites.length > 0) {
    await Promise.all(
      normalizeWrites.map(async (write) => {
        try {
          await write;
        } catch {
          // ignore best-effort normalization failures
        }
      })
    );
  }

  return mapped.map((item) => item.recipe);
}

export async function getRecipe(id: string): Promise<Recipe | undefined> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return undefined;

  const mapped = mapRecipeRow(data);

  // Recipes last saved by an older build of the app have photos but no thumbnail.
  if (mapped.recipe.dishPhotos.length > 0 && !data.dish_thumbnail) {
    void makeDishThumbnail(mapped.recipe.dishPhotos[0]).then(async (thumbnail) => {
      if (!thumbnail) return;
      await supabase.from("recipes").update({ dish_thumbnail: thumbnail }).eq("id", id);
      clearRecipesCache();
    });
  }

  if (mapped.normalizedStepsChanged) {
    await supabase
      .from("recipes")
      .update({
        steps: serializeRecipeSteps(mapped.recipe),
        updated_at: mapped.recipe.updatedAt,
      })
      .eq("id", mapped.recipe.id);
  }

  return mapped.recipe;
}

// A single recipe without its full-size photos, for screens that don't show them.
export async function getRecipeSummary(id: string): Promise<Recipe | undefined> {
  const { data, error } = await getSupabase()
    .from("recipes")
    .select(RECIPE_SUMMARY_COLUMNS)
    .eq("id", id)
    .single();

  if (error || !data) return undefined;
  return mapRecipeRow(data).recipe;
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  if (recipe.isSummary) {
    // A summary only has a thumbnail; saving it would overwrite the real photos.
    throw new Error("Cannot save a recipe loaded without its photos");
  }
  const supabase = getSupabase();
  const userId = await getUserId();
  const serializedSteps = serializeRecipeSteps(recipe);
  const dishThumbnail = await makeDishThumbnail(recipe.dishPhotos[0]);
  const { error } = await supabase.from("recipes").upsert({
    id: recipe.id,
    user_id: userId,
    name: recipe.name,
    ingredients: recipe.ingredients,
    steps: serializedSteps,
    notes: recipe.notes,
    rating: recipe.rating ?? null,
    servings_yielded: recipe.servingsYielded ?? null,
    dish_photos: recipe.dishPhotos,
    dish_thumbnail: dishThumbnail,
    ingredient_photo: recipe.ingredientPhoto || null,
    source_url: recipe.sourceUrl || null,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
  });

  if (error) throw error;
  clearRecipesCache();
}

export async function deleteRecipe(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error: planError } = await supabase
    .from("weekly_plans")
    .delete()
    .eq("recipe_id", id);
  if (planError) throw planError;

  const { error: mealPlanError } = await supabase
    .from("meal_plan_entries")
    .delete()
    .eq("recipe_id", id);
  if (mealPlanError) throw mealPlanError;

  const { error: ratingsError } = await supabase
    .from("recipe_ratings")
    .delete()
    .eq("recipe_id", id);
  if (ratingsError) throw ratingsError;

  const { error: cookLogsError } = await supabase
    .from("recipe_cook_logs")
    .delete()
    .eq("recipe_id", id);
  if (cookLogsError) throw cookLogsError;

  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
  clearRecipesCache();
}

export async function getWeeklyPlanIds(): Promise<string[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  let query = supabase.from("weekly_plans").select("recipe_id");
  if (householdId) {
    query = query.eq("household_id", householdId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row) => row.recipe_id);
}

export async function setWeeklyPlanIds(ids: string[]): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  // Delete existing
  let deleteQuery = supabase.from("weekly_plans").delete();
  if (householdId) {
    deleteQuery = deleteQuery.eq("household_id", householdId);
  } else {
    deleteQuery = deleteQuery.eq("user_id", userId);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  // Insert new
  if (ids.length > 0) {
    const { error: insertError } = await supabase
      .from("weekly_plans")
      .insert(
        ids.map((recipe_id) => ({
          user_id: userId,
          recipe_id,
          ...(householdId ? { household_id: householdId } : {}),
        }))
      );
    if (insertError) throw insertError;
  }
}

export async function getShoppingList(): Promise<ShoppingListItem[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  let query = supabase.from("shopping_list").select("*");
  if (householdId) {
    query = query.eq("household_id", householdId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    section: row.section,
    recipeIds: row.recipe_ids as string[],
    recipeNames: row.recipe_names as string[],
    checked: row.checked,
  }));
}

// Manually added items (no recipe) live in the same table, but the list built
// from recipes is rewritten wholesale whenever the selection changes — so it
// only ever touches recipe rows, and manual items are written one at a time.
export function isManualShoppingItem(item: ShoppingListItem): boolean {
  return item.recipeIds.length === 0;
}

function toShoppingRow(
  item: ShoppingListItem,
  userId: string,
  householdId: string | null
) {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    section: item.section,
    recipe_ids: item.recipeIds,
    recipe_names: item.recipeNames,
    checked: item.checked,
    ...(householdId ? { household_id: householdId } : {}),
  };
}

/** Replace the recipe-generated items. Manual items are left alone. */
export async function saveShoppingList(
  list: ShoppingListItem[]
): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();
  const recipeItems = list.filter((item) => !isManualShoppingItem(item));

  let deleteQuery = supabase.from("shopping_list").delete().neq("recipe_ids", "[]");
  if (householdId) {
    deleteQuery = deleteQuery.eq("household_id", householdId);
  } else {
    deleteQuery = deleteQuery.eq("user_id", userId);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  if (recipeItems.length > 0) {
    const { error: insertError } = await supabase
      .from("shopping_list")
      .insert(recipeItems.map((item) => toShoppingRow(item, userId, householdId)));
    if (insertError) throw insertError;
  }
}

/** Insert or update a single manually added item. */
export async function saveManualShoppingItem(item: ShoppingListItem): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  const { error } = await supabase
    .from("shopping_list")
    .upsert(toShoppingRow({ ...item, recipeIds: [], recipeNames: [] }, userId, householdId));
  if (error) throw error;
}

export async function deleteShoppingItem(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("shopping_list").delete().eq("id", id);
  if (error) throw error;
}
