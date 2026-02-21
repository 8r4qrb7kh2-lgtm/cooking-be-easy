import { Recipe } from "./types";
import { RecentRecipeViews } from "./recentViews";

export type RecipeSortOption = "recently-viewed" | "rating-desc";

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

export function sortRecipes(
  recipes: Recipe[],
  sortOption: RecipeSortOption,
  recentViewsByRecipeId: RecentRecipeViews
): Recipe[] {
  const sorted = [...recipes];
  sorted.sort((a, b) =>
    sortOption === "rating-desc"
      ? compareByRating(a, b, recentViewsByRecipeId)
      : compareByRecentlyViewed(a, b, recentViewsByRecipeId)
  );
  return sorted;
}
