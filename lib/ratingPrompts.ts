import { addDaysToKey, todayKey } from "./mealPlan";

// Tracks which "how was it?" rating prompts a user has already been shown, so
// each dish is only asked about once per cook. Kept in localStorage (per user,
// per recipe, per day cooked) rather than the DB — it's lightweight UI state
// and doesn't need to sync across devices.
const RATING_PROMPTS_HANDLED_KEY = "cooking-be-easy-rating-prompts-handled";

// The prompt can appear 1 or 2 days after cooking, so nothing older than that
// is ever relevant. Prune generously past that window to bound storage.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type HandledPrompts = Record<string, number>; // compositeKey -> handled-at ms

function compositeKey(
  userId: string,
  recipeId: string,
  cookedOn: string
): string {
  return `${userId}::${recipeId}::${cookedOn}`;
}

function readHandled(): HandledPrompts {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(RATING_PROMPTS_HANDLED_KEY) ?? "{}"
    );
    if (!parsed || typeof parsed !== "object") return {};
    const out: HandledPrompts = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (key && typeof value === "number" && Number.isFinite(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeHandled(handled: HandledPrompts) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const pruned: HandledPrompts = {};
  for (const [key, value] of Object.entries(handled)) {
    if (now - value < MAX_AGE_MS) pruned[key] = value;
  }
  window.localStorage.setItem(
    RATING_PROMPTS_HANDLED_KEY,
    JSON.stringify(pruned)
  );
}

export function wasRatingPromptHandled(
  userId: string,
  recipeId: string,
  cookedOn: string
): boolean {
  return compositeKey(userId, recipeId, cookedOn) in readHandled();
}

// Records that the user has dealt with (rated or dismissed) the rating prompt
// for this recipe. Marks every day in the current prompt window (1 and 2 days
// ago) so the dish isn't asked about again until it's next cooked.
export function markRecipeRatingHandled(userId: string, recipeId: string) {
  const handled = readHandled();
  const now = Date.now();
  const today = todayKey();
  for (const daysAgo of [1, 2]) {
    handled[compositeKey(userId, recipeId, addDaysToKey(today, -daysAgo))] = now;
  }
  writeHandled(handled);
}
