import { CookLogEntry } from "./types";
import { getSupabase } from "./supabase";
import { todayKey } from "./mealPlan";

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

function mapCookLogRow(row: any): CookLogEntry | null {
  if (
    typeof row?.id !== "string" ||
    typeof row.recipe_id !== "string" ||
    typeof row.user_id !== "string" ||
    typeof row.cooked_on !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    recipeId: row.recipe_id,
    userId: row.user_id,
    cookedOn: row.cooked_on.slice(0, 10),
  };
}

export async function getCookLogs(): Promise<CookLogEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_cook_logs")
    .select("*")
    .order("cooked_on", { ascending: true });
  if (error) throw error;
  return (data || [])
    .map(mapCookLogRow)
    .filter((log): log is CookLogEntry => log !== null);
}

// Whether this recipe already has a cook log for today visible to the current
// user. RLS scopes the query to the user's own logs plus their household's, so
// this is true once anyone cooking together has confirmed the dish today.
export async function wasCookedToday(recipeId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("recipe_cook_logs")
    .select("id")
    .eq("recipe_id", recipeId)
    .eq("cooked_on", todayKey())
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

// Records that this recipe was made today. Capped at one log per dish per day
// across a household: if anyone the user shares logs with (or the user
// themselves) has already logged it today, this is a no-op, so several people
// cooking the same dish together don't each create a log.
export async function logCookedToday(recipeId: string): Promise<void> {
  if (await wasCookedToday(recipeId)) return;

  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  const { error } = await supabase.from("recipe_cook_logs").upsert(
    {
      recipe_id: recipeId,
      user_id: userId,
      household_id: householdId,
      cooked_on: todayKey(),
    },
    { onConflict: "user_id,recipe_id,cooked_on", ignoreDuplicates: true }
  );
  if (error) throw error;
}
