const RECENT_RECIPE_VIEWS_KEY = "cooking-be-easy-recent-recipe-views";
const MAX_TRACKED_RECIPES = 250;

export type RecentRecipeViews = Record<string, number>;

function parseStoredViews(rawValue: string | null): RecentRecipeViews {
  if (!rawValue) return {};

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") return {};

    const entries: Array<[string, number]> = [];
    for (const [recipeId, viewedAt] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (!recipeId || typeof viewedAt !== "number" || !Number.isFinite(viewedAt)) {
        continue;
      }
      entries.push([recipeId, viewedAt]);
    }

    return Object.fromEntries(entries) as RecentRecipeViews;
  } catch {
    return {};
  }
}

export function getRecentRecipeViews(): RecentRecipeViews {
  if (typeof window === "undefined") return {};
  return parseStoredViews(window.localStorage.getItem(RECENT_RECIPE_VIEWS_KEY));
}

export function markRecipeViewed(recipeId: string) {
  if (typeof window === "undefined") return;
  if (!recipeId) return;

  const existing = getRecentRecipeViews();
  const next: RecentRecipeViews = {
    ...existing,
    [recipeId]: Date.now(),
  };

  const trimmedEntries = Object.entries(next)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TRACKED_RECIPES);

  window.localStorage.setItem(
    RECENT_RECIPE_VIEWS_KEY,
    JSON.stringify(Object.fromEntries(trimmedEntries))
  );
}
