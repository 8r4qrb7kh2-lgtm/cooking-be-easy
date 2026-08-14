import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "./supabase";
import { todayKey } from "./mealPlan";
import {
  COOK_MINUTES_STEP,
  MAX_COOK_MINUTES,
  MIN_COOK_MINUTES,
} from "./cookTimes";

// Cooking mode times itself so the user doesn't have to. Each visit to a dish's
// cooking-mode screen writes a session (opened at / last still open at), and the
// post-cook "how long did it take?" prompt reads those back: first open to last
// close on the day the dish was cooked is what it pre-fills the slider with.
//
// Sessions are per-user — this measures how long *this* person had the recipe
// open, which is what their own reported cook time means.

// How often an open cooking-mode screen refreshes its ended_at. A closed tab
// (or a PWA the OS kills) never gets to write on the way out, so the heartbeat —
// not the exit — is what actually bounds a session: the estimate can be short by
// at most this much, which rounds away against a 5-minute slider step.
export const COOKING_SESSION_HEARTBEAT_MS = 30_000;

async function getUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

// Opens a session for a dish and returns its id, or null if it couldn't be
// recorded (signed out, offline). The id is minted here rather than read back
// from the insert so the caller can start refreshing it right away.
export async function startCookingSession(
  recipeId: string
): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const id = uuidv4();
  const now = new Date().toISOString();
  const { error } = await getSupabase().from("cooking_mode_sessions").insert({
    id,
    user_id: userId,
    recipe_id: recipeId,
    // Local day, matching how cook logs are dated, so a session lines up with
    // the cook the rating prompt is asking about.
    cooked_on: todayKey(),
    started_at: now,
    ended_at: now,
  });
  if (error) return null;
  return id;
}

// Marks a session as still open as of now. Called on the heartbeat and again on
// the way out, so ended_at ends up at (or just before) the moment the user left
// cooking mode. Failures are ignored — a missed beat only costs precision.
export async function touchCookingSession(sessionId: string): Promise<void> {
  await getSupabase()
    .from("cooking_mode_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// Rounds a raw elapsed time onto the cook-time slider: whole 5-minute steps,
// never outside the range the slider can represent.
function snapToSliderMinutes(minutes: number): number {
  const stepped = Math.round(minutes / COOK_MINUTES_STEP) * COOK_MINUTES_STEP;
  return Math.min(MAX_COOK_MINUTES, Math.max(MIN_COOK_MINUTES, stepped));
}

export interface CookingModeSession {
  startedAt: string;
  endedAt: string;
}

// First open to last close across a day's sessions, as a slider-ready number of
// minutes. Null when there's nothing usable — no sessions, or timestamps that
// don't parse.
export function cookMinutesFromSessions(
  sessions: CookingModeSession[]
): number | null {
  let openedAt = Number.POSITIVE_INFINITY;
  let closedAt = Number.NEGATIVE_INFINITY;

  for (const session of sessions) {
    const started = Date.parse(session.startedAt);
    if (!Number.isFinite(started)) continue;
    // A session that never got a beat past its insert still counts as a moment
    // in cooking mode.
    const ended = Date.parse(session.endedAt);
    openedAt = Math.min(openedAt, started);
    closedAt = Math.max(closedAt, Number.isFinite(ended) ? ended : started);
  }

  if (!Number.isFinite(openedAt) || !Number.isFinite(closedAt)) return null;

  const elapsedMinutes = (closedAt - openedAt) / 60_000;
  if (elapsedMinutes <= 0) return null;
  return snapToSliderMinutes(elapsedMinutes);
}

// What the app thinks the dish took: from the first time this user opened
// cooking mode for it that day to the last time they were still in it. Spans
// every visit that day, so stepping out mid-cook and coming back still counts as
// one stretch of cooking. Null when there's nothing to go on — no sessions
// recorded (the dish was logged without using cooking mode, or it predates this
// tracking), signed out, or the read failed.
export async function estimateCookMinutes(
  recipeId: string,
  cookedOn: string
): Promise<number | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const { data, error } = await getSupabase()
    .from("cooking_mode_sessions")
    .select("started_at, ended_at")
    .eq("user_id", userId)
    .eq("recipe_id", recipeId)
    .eq("cooked_on", cookedOn);
  if (error || !data || data.length === 0) return null;

  return cookMinutesFromSessions(
    data.map((row) => ({ startedAt: row.started_at, endedAt: row.ended_at }))
  );
}
