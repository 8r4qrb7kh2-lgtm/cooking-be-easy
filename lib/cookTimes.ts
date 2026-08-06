import { RecipeCookTime } from "./types";
import { getSupabase } from "./supabase";

// How long a dish takes is reported per person (the post-cook prompt asks, the
// recipe page lets you edit it) and shown as the average across everyone who
// reported — so a dish two people cook lands between their two times.

export const MIN_COOK_MINUTES = 5;
export const MAX_COOK_MINUTES = 240;
export const COOK_MINUTES_STEP = 5;
// Where the slider starts when someone hasn't recorded a time yet.
export const DEFAULT_COOK_MINUTES = 30;

export function formatCookTime(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// --- Colour scale: green (fastest) → red (longest) ---

// The scale is widened to at least this many minutes so a set of dishes that all
// take about the same time isn't stretched across the whole range and made to
// look wildly different.
const MIN_COOK_TIME_SPREAD_MINUTES = 30;

export interface CookTimeScale {
  min: number;
  max: number;
}

// Built from the times actually on screen, so the colours stay meaningful as the
// planner's pool is filtered. Null when nobody has reported a time yet.
export function buildCookTimeScale(values: number[]): CookTimeScale | null {
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high - low >= MIN_COOK_TIME_SPREAD_MINUTES) return { min: low, max: high };
  const min = Math.max(0, (low + high) / 2 - MIN_COOK_TIME_SPREAD_MINUTES / 2);
  return { min, max: min + MIN_COOK_TIME_SPREAD_MINUTES };
}

// Hue 140 (green) → 0 (red), passing through yellow and orange on the way.
// The square root spreads the short end out: cook times bunch up in the 20–60
// minute range with a long tail, so a linear ramp would paint nearly everything
// the same green and reserve the rest of the scale for one or two outliers.
export function cookTimeHue(minutes: number, scale: CookTimeScale): number {
  const span = scale.max - scale.min;
  if (span <= 0) return 140;
  const t = Math.min(1, Math.max(0, (minutes - scale.min) / span));
  return 140 - 140 * Math.sqrt(t);
}

export function cookTimeChipStyle(hue: number): {
  background: string;
  borderColor: string;
} {
  return {
    background: `hsl(${hue}, 80%, 89%)`,
    borderColor: `hsl(${hue}, 58%, 55%)`,
  };
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

function mapCookTimeRow(row: any): RecipeCookTime | null {
  if (
    typeof row?.recipe_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.minutes !== "number"
  ) {
    return null;
  }
  return {
    recipeId: row.recipe_id,
    userId: row.user_id,
    userName: typeof row.user_name === "string" ? row.user_name : null,
    minutes: row.minutes,
  };
}

// RLS scopes reads to the caller's own + household rows, so a bare select
// returns exactly what the user is allowed to see (mirrors getRecipeRatings).
export async function getRecipeCookTimes(): Promise<RecipeCookTime[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("recipe_cook_times").select("*");
  if (error) throw error;
  return (data || [])
    .map(mapCookTimeRow)
    .filter((cookTime): cookTime is RecipeCookTime => cookTime !== null);
}

export async function getCookTimesForRecipe(
  recipeId: string
): Promise<RecipeCookTime[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_cook_times")
    .select("*")
    .eq("recipe_id", recipeId);
  if (error) throw error;
  return (data || [])
    .map(mapCookTimeRow)
    .filter((cookTime): cookTime is RecipeCookTime => cookTime !== null);
}

// The number the app displays: the mean of every reported time for the dish.
export function averageCookMinutes(cookTimes: RecipeCookTime[]): number | null {
  if (cookTimes.length === 0) return null;
  const sum = cookTimes.reduce((total, cookTime) => total + cookTime.minutes, 0);
  return sum / cookTimes.length;
}

// Groups times by recipe and averages each, ready for the planner plot.
export function averageCookMinutesByRecipeId(
  cookTimes: RecipeCookTime[]
): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const cookTime of cookTimes) {
    const existing = totals.get(cookTime.recipeId);
    if (existing) {
      existing.sum += cookTime.minutes;
      existing.count += 1;
    } else {
      totals.set(cookTime.recipeId, { sum: cookTime.minutes, count: 1 });
    }
  }
  return new Map(
    Array.from(totals.entries()).map(([recipeId, { sum, count }]) => [
      recipeId,
      sum / count,
    ])
  );
}

// Sets (or clears, when minutes is null) the current user's cook time for a dish.
export async function saveMyCookTime(params: {
  recipeId: string;
  userName: string | null;
  minutes: number | null;
}): Promise<RecipeCookTime[]> {
  const supabase = getSupabase();
  const userId = await getUserId();

  if (params.minutes === null) {
    const { error } = await supabase
      .from("recipe_cook_times")
      .delete()
      .eq("recipe_id", params.recipeId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const householdId = await getHouseholdId();
    const { error } = await supabase.from("recipe_cook_times").upsert(
      {
        recipe_id: params.recipeId,
        user_id: userId,
        household_id: householdId,
        minutes: Math.round(params.minutes),
        user_name: params.userName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "recipe_id,user_id" }
    );
    if (error) throw error;
  }

  return getCookTimesForRecipe(params.recipeId);
}
