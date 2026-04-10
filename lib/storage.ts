import { Recipe, ShoppingListItem } from "./types";
import { getSupabase } from "./supabase";
import { normalizeRecipeSteps } from "./recipeSteps";

function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function getUserId(): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user.id;
}

async function getHouseholdId(): Promise<string | null> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .single();
  return data?.household_id ?? null;
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
      dishPhotos: row.dish_photos || [],
      ingredientPhoto: row.ingredient_photo || undefined,
      sourceUrl: row.source_url || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    normalizedStepsChanged: parsedSteps.normalizedStepsChanged,
  };
}

export async function getRecipes(): Promise<Recipe[]> {
  const supabase = getSupabase();
  // RLS handles filtering: returns own recipes + household members' recipes
  const { data, error } = await supabase
    .from("recipes")
    .select("*")
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

export async function saveRecipe(recipe: Recipe): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const serializedSteps = serializeRecipeSteps(recipe);
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
    ingredient_photo: recipe.ingredientPhoto || null,
    source_url: recipe.sourceUrl || null,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
  });

  if (error) throw error;
}

export async function deleteRecipe(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error: planError } = await supabase
    .from("weekly_plans")
    .delete()
    .eq("recipe_id", id);
  if (planError) throw planError;

  const { error } = await supabase.from("recipes").delete().eq("id", id);
  if (error) throw error;
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

export async function saveShoppingList(
  list: ShoppingListItem[]
): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  // Delete existing list
  let deleteQuery = supabase.from("shopping_list").delete();
  if (householdId) {
    deleteQuery = deleteQuery.eq("household_id", householdId);
  } else {
    deleteQuery = deleteQuery.eq("user_id", userId);
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  // Insert new list
  if (list.length > 0) {
    const { error: insertError } = await supabase
      .from("shopping_list")
      .insert(
        list.map((item) => ({
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
        }))
      );
    if (insertError) throw insertError;
  }
}
