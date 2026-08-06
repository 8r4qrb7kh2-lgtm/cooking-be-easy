import { todayKey } from "./mealPlan";
import { getSupabase } from "./supabase";

// Tracks which post-cook "how was it?" rating prompts a user has already handled,
// so each dish is asked about at most once per user — ever, across every cook.
// Persisted in recipe_rating_prompts (per-user, RLS-scoped) rather than
// localStorage, so the "asked once" state follows the user across all devices.

async function getUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// The set of recipe IDs the current user has already been prompted about (rated
// or dismissed). Collapsed to the recipe level so a dish asked about once is
// never asked about again, even when it's cooked again later. RLS returns only
// the user's own rows.
export async function getHandledRecipeIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_rating_prompts")
    .select("recipe_id");
  if (error) throw error;
  const handled = new Set<string>();
  for (const row of data ?? []) {
    if (typeof row.recipe_id === "string") handled.add(row.recipe_id);
  }
  return handled;
}

// Records that the user has dealt with (rated or dismissed) this recipe's prompt
// so it's never asked about again. One row is enough — reads collapse to the
// recipe — so this records which cook it was asked about (falling back to today
// when the date isn't known). Idempotent via the primary key.
export async function markRecipeRatingHandled(
  recipeId: string,
  cookedOn?: string
): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  const supabase = getSupabase();
  const { error } = await supabase.from("recipe_rating_prompts").upsert(
    { user_id: userId, recipe_id: recipeId, cooked_on: cookedOn ?? todayKey() },
    { onConflict: "user_id,recipe_id,cooked_on", ignoreDuplicates: true }
  );
  if (error) throw error;
}
