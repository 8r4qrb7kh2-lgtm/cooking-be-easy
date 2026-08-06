import { MealPlanEntry, MealSlot } from "./types";
import { getSupabase } from "./supabase";

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Local calendar-date helpers. Keys are YYYY-MM-DD in local time so a meal
// planned for "Tuesday" stays on Tuesday regardless of timezone. ---

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function addDaysToKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

// Monday-based week start
export function startOfWeekKey(key: string): string {
  const offset = (parseDateKey(key).getDay() + 6) % 7;
  return addDaysToKey(key, -offset);
}

export function daysBetweenKeys(fromKey: string, toKey: string): number {
  return Math.round(
    (parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / DAY_MS
  );
}

// --- Derived stats: past plan entries double as the cooking history ---

export interface RecipeMealStats {
  lastMadeKey: string | null;
  daysSinceMade: number | null; // null = never made
  timesMade: number;
}

export const NEVER_MADE_STATS: RecipeMealStats = {
  lastMadeKey: null,
  daysSinceMade: null,
  timesMade: 0,
};

export interface DatedRecipeEvent {
  recipeId: string;
  date: string; // YYYY-MM-DD
}

// Events dated on or before `asOfKey` count as "made"; anything later is ignored.
// Cook logs are the source of these events (each log = the dish made that day).
export function computeRecipeMealStats(
  events: DatedRecipeEvent[],
  asOfKey: string
): Record<string, RecipeMealStats> {
  const statsByRecipeId: Record<string, RecipeMealStats> = {};

  for (const event of events) {
    if (event.date > asOfKey) continue;

    const existing = statsByRecipeId[event.recipeId];
    if (!existing) {
      statsByRecipeId[event.recipeId] = {
        lastMadeKey: event.date,
        daysSinceMade: daysBetweenKeys(event.date, asOfKey),
        timesMade: 1,
      };
      continue;
    }

    existing.timesMade += 1;
    if (!existing.lastMadeKey || event.date > existing.lastMadeKey) {
      existing.lastMadeKey = event.date;
      existing.daysSinceMade = daysBetweenKeys(event.date, asOfKey);
    }
  }

  return statsByRecipeId;
}

export function formatDaysSinceMade(daysSinceMade: number | null): string {
  if (daysSinceMade === null) return "never made";
  if (daysSinceMade === 0) return "made today";
  if (daysSinceMade === 1) return "made 1d ago";
  return `made ${daysSinceMade}d ago`;
}

export function formatDaysSinceMadeShort(daysSinceMade: number | null): string {
  if (daysSinceMade === null) return "never";
  if (daysSinceMade === 0) return "today";
  return `${daysSinceMade}d`;
}

// --- Supabase CRUD (mirrors lib/storage.ts patterns) ---

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

function isMealSlot(value: unknown): value is MealSlot {
  return value === "lunch" || value === "dinner";
}

function mapEntryRow(row: any): MealPlanEntry | null {
  if (
    typeof row?.id !== "string" ||
    typeof row.recipe_id !== "string" ||
    typeof row.plan_date !== "string" ||
    !isMealSlot(row.slot)
  ) {
    return null;
  }

  return {
    id: row.id,
    recipeId: row.recipe_id,
    planDate: row.plan_date.slice(0, 10),
    slot: row.slot,
    isLeftovers: row.is_leftovers === true,
  };
}

export async function getMealPlanEntries(): Promise<MealPlanEntry[]> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  let query = supabase.from("meal_plan_entries").select("*");
  if (householdId) {
    query = query.eq("household_id", householdId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.order("plan_date", { ascending: true });
  if (error) throw error;

  return (data || [])
    .map(mapEntryRow)
    .filter((entry): entry is MealPlanEntry => entry !== null);
}

export async function addMealPlanEntry(entry: MealPlanEntry): Promise<void> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  const { error } = await supabase.from("meal_plan_entries").insert({
    id: entry.id,
    user_id: userId,
    recipe_id: entry.recipeId,
    plan_date: entry.planDate,
    slot: entry.slot,
    is_leftovers: entry.isLeftovers,
    ...(householdId ? { household_id: householdId } : {}),
  });
  if (error) throw error;
}

export async function moveMealPlanEntry(
  id: string,
  planDate: string,
  slot: MealSlot
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("meal_plan_entries")
    .update({ plan_date: planDate, slot })
    .eq("id", id);
  if (error) throw error;
}

export async function removeMealPlanEntry(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("meal_plan_entries")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
