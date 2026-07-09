import { addDaysToKey, todayKey } from "./mealPlan";
import { getSupabase } from "./supabase";

// Tracks which post-cook "how was it?" rating prompts a user has already been
// shown, so each dish is asked about at most once per cook. Persisted in
// recipe_rating_prompts (per-user, RLS-scoped) rather than localStorage, so the
// "asked once" state follows the user across all of their devices.

async function getUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// Builds the `${recipeId}::${cookedOn}` key used to match a handled prompt to a
// specific cook-log entry.
export function ratingPromptKey(recipeId: string, cookedOn: string): string {
  return `${recipeId}::${cookedOn}`;
}

// The set of rating prompts the current user has already handled, as
// `${recipeId}::${cookedOn}` keys. RLS returns only the user's own rows.
export async function getHandledRatingPrompts(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_rating_prompts")
    .select("recipe_id, cooked_on");
  if (error) throw error;
  const handled = new Set<string>();
  for (const row of data ?? []) {
    if (typeof row.recipe_id === "string" && typeof row.cooked_on === "string") {
      handled.add(ratingPromptKey(row.recipe_id, row.cooked_on.slice(0, 10)));
    }
  }
  return handled;
}

// The keys marked when a user deals with a recipe's prompt: both days in the
// current 1–2 day window, so the dish isn't re-asked for the rest of it. Pure,
// so callers can update their in-memory view immediately without a round-trip.
export function ratingPromptKeysForToday(recipeId: string): string[] {
  const today = todayKey();
  return [
    ratingPromptKey(recipeId, addDaysToKey(today, -1)),
    ratingPromptKey(recipeId, addDaysToKey(today, -2)),
  ];
}

// Records that the user has dealt with (rated or dismissed) this recipe's
// prompt, marking both days in the current window so it isn't asked about again
// until the dish is next cooked. Idempotent via the primary key.
export async function markRecipeRatingHandled(recipeId: string): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  const today = todayKey();
  const rows = [addDaysToKey(today, -1), addDaysToKey(today, -2)].map(
    (cooked_on) => ({ user_id: userId, recipe_id: recipeId, cooked_on })
  );
  const supabase = getSupabase();
  const { error } = await supabase
    .from("recipe_rating_prompts")
    .upsert(rows, {
      onConflict: "user_id,recipe_id,cooked_on",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}
