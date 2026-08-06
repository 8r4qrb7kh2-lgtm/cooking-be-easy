import { Recipe } from "./types";
import { RecentRecipeViews } from "./recentViews";

export type RecipeSortOption =
  | "recently-viewed"
  | "rating-desc"
  | "last-cooked-desc";

// recipeId -> YYYY-MM-DD of the most recent cook log. Missing = never cooked.
export type LastCookedByRecipeId = Record<string, string>;

function getLastViewedAt(recipeId: string, recentViewsByRecipeId: RecentRecipeViews): number {
  return recentViewsByRecipeId[recipeId] ?? 0;
}

function getRatingScore(recipe: Recipe): number {
  return recipe.rating ?? 0;
}

function getUpdatedAtTimestamp(recipe: Recipe): number {
  const parsed = Date.parse(recipe.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Date keys sort correctly as strings; "" (never cooked) sorts below every date,
// which puts never-cooked recipes at the end of a most-recent-first list.
function getLastCookedKey(
  recipeId: string,
  lastCookedByRecipeId: LastCookedByRecipeId
): string {
  return lastCookedByRecipeId[recipeId] ?? "";
}

function compareByRecentlyViewed(
  a: Recipe,
  b: Recipe,
  recentViewsByRecipeId: RecentRecipeViews
) {
  const recentDiff =
    getLastViewedAt(b.id, recentViewsByRecipeId) -
    getLastViewedAt(a.id, recentViewsByRecipeId);
  if (recentDiff !== 0) return recentDiff;

  const ratingDiff = getRatingScore(b) - getRatingScore(a);
  if (ratingDiff !== 0) return ratingDiff;

  const updatedDiff = getUpdatedAtTimestamp(b) - getUpdatedAtTimestamp(a);
  if (updatedDiff !== 0) return updatedDiff;

  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareByRating(
  a: Recipe,
  b: Recipe,
  recentViewsByRecipeId: RecentRecipeViews
) {
  const ratingDiff = getRatingScore(b) - getRatingScore(a);
  if (ratingDiff !== 0) return ratingDiff;

  const recentDiff =
    getLastViewedAt(b.id, recentViewsByRecipeId) -
    getLastViewedAt(a.id, recentViewsByRecipeId);
  if (recentDiff !== 0) return recentDiff;

  const updatedDiff = getUpdatedAtTimestamp(b) - getUpdatedAtTimestamp(a);
  if (updatedDiff !== 0) return updatedDiff;

  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareByLastCooked(
  a: Recipe,
  b: Recipe,
  recentViewsByRecipeId: RecentRecipeViews,
  lastCookedByRecipeId: LastCookedByRecipeId
) {
  const cookedDiff = getLastCookedKey(b.id, lastCookedByRecipeId).localeCompare(
    getLastCookedKey(a.id, lastCookedByRecipeId)
  );
  if (cookedDiff !== 0) return cookedDiff;

  // Same day (or both never cooked) — fall back to the usual ordering.
  return compareByRecentlyViewed(a, b, recentViewsByRecipeId);
}

export function sortRecipes(
  recipes: Recipe[],
  sortOption: RecipeSortOption,
  recentViewsByRecipeId: RecentRecipeViews,
  lastCookedByRecipeId: LastCookedByRecipeId = {}
): Recipe[] {
  const sorted = [...recipes];
  sorted.sort((a, b) => {
    if (sortOption === "rating-desc") {
      return compareByRating(a, b, recentViewsByRecipeId);
    }
    if (sortOption === "last-cooked-desc") {
      return compareByLastCooked(a, b, recentViewsByRecipeId, lastCookedByRecipeId);
    }
    return compareByRecentlyViewed(a, b, recentViewsByRecipeId);
  });
  return sorted;
}
