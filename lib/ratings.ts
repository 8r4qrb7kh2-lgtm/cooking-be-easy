import { User } from "@supabase/supabase-js";
import { RecipeRating } from "./types";
import { getSupabase } from "./supabase";

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

export function getDisplayName(user: User | null): string | null {
  if (!user) return null;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [metadata.full_name, metadata.name, user.email];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function mapRatingRow(row: any): RecipeRating | null {
  if (
    typeof row?.recipe_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.rating !== "number"
  ) {
    return null;
  }
  return {
    recipeId: row.recipe_id,
    userId: row.user_id,
    userName: typeof row.user_name === "string" ? row.user_name : null,
    rating: row.rating,
  };
}

// RLS scopes reads to the caller's own + household ratings, so a bare select
// returns exactly the rows the user is allowed to see.
export async function getRecipeRatings(): Promise<RecipeRating[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("recipe_ratings").select("*");
  if (error) throw error;
  return (data || [])
    .map(mapRatingRow)
    .filter((rating): rating is RecipeRating => rating !== null);
}

export async function getRatingsForRecipe(
  recipeId: string
): Promise<RecipeRating[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_ratings")
    .select("*")
    .eq("recipe_id", recipeId);
  if (error) throw error;
  return (data || [])
    .map(mapRatingRow)
    .filter((rating): rating is RecipeRating => rating !== null);
}

export function averageRating(ratings: RecipeRating[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, rating) => total + rating.rating, 0);
  return sum / ratings.length;
}

// Sets (or clears, when rating is null) the current user's rating, then refreshes
// the cached average on recipes.rating so the library/shopping sorts stay correct.
export async function saveMyRating(params: {
  recipeId: string;
  userName: string | null;
  rating: number | null;
}): Promise<RecipeRating[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  if (params.rating === null) {
    const { error } = await supabase
      .from("recipe_ratings")
      .delete()
      .eq("recipe_id", params.recipeId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("recipe_ratings").upsert(
      {
        recipe_id: params.recipeId,
        user_id: userId,
        household_id: householdId,
        rating: params.rating,
        user_name: params.userName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recipe_id,user_id" }
    );
    if (error) throw error;
  }

  const fresh = await getRatingsForRecipe(params.recipeId);
  const average = averageRating(fresh);
  await supabase
    .from("recipes")
    .update({ rating: average === null ? null : Math.round(average) })
    .eq("id", params.recipeId);

  return fresh;
}
