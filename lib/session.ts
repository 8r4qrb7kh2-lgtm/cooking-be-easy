import { getSupabase } from "./supabase";

export async function getUserId(): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user.id;
}

// Household membership rarely changes, but nearly every read and write needs
// it, so the lookup is remembered briefly instead of costing a round trip ahead
// of each query.
const HOUSEHOLD_CACHE_MS = 5 * 60 * 1000;
let householdCache: {
  userId: string;
  loadedAt: number;
  householdId: Promise<string | null>;
} | null = null;

export async function getHouseholdId(): Promise<string | null> {
  const userId = await getUserId();
  const cached = householdCache;
  if (
    cached &&
    cached.userId === userId &&
    Date.now() - cached.loadedAt < HOUSEHOLD_CACHE_MS
  ) {
    return cached.householdId;
  }

  const householdId = (async () => {
    const { data } = await getSupabase()
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .single();
    return (data?.household_id as string | undefined) ?? null;
  })();
  householdCache = { userId, loadedAt: Date.now(), householdId };
  return householdId;
}

// Call after the user joins or leaves a household.
export function clearHouseholdCache() {
  householdCache = null;
}
