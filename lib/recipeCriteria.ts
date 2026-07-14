import { Recipe } from "./types";
import { RecipeMealStats } from "./mealPlan";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CriterionId =
  | "daysSinceMade"
  | "rating"
  | "timesMade"
  | "ingredientCount"
  | "daysInLibrary";

// Everything a criterion might read, precomputed per recipe. `rating` is already
// resolved for whichever rater the plot is using (average or a specific person).
export interface RecipeMetrics {
  daysSinceMade: number | null;
  timesMade: number;
  rating: number | null;
  ingredientCount: number;
  daysInLibrary: number;
}

export interface RecipeCriterion {
  id: CriterionId;
  label: string;
  unit: string;
  // null = the recipe has no value for this criterion (never made / unrated)
  getValue: (metrics: RecipeMetrics) => number | null;
  // Which end of the scale a null value conceptually sits at: never-made is
  // beyond the oldest "days since made", unrated is below every rating.
  nullSide: "low" | "high" | null;
  nullLabel: string | null;
  // When this criterion is a plot axis, recipes with no value for it are left
  // off the plot entirely instead of shown in a null band (e.g. unrated dishes
  // shouldn't clutter a rating axis). Filters still use nullSide as usual.
  hideNullOnPlot?: boolean;
  // Optional easing applied to the normalized [0,1] axis position so the scale
  // needn't be linear. Must map 0→0 and 1→1. `t => t*t`, for example, bunches
  // small values near the origin and spreads large ones out.
  warpPosition?: (t: number) => number;
  fixedDomain?: [number, number];
  // Floor for the auto-computed domain max so sparse data still gets a usable axis
  minDomainMax?: number;
  formatTick: (value: number) => string;
}

function daysInLibrary(createdAt: string, nowMs: number): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((nowMs - created) / DAY_MS));
}

export function buildRecipeMetrics(
  recipe: Recipe,
  stats: RecipeMealStats,
  resolvedRating: number | null,
  nowMs: number
): RecipeMetrics {
  return {
    daysSinceMade: stats.daysSinceMade,
    timesMade: stats.timesMade,
    rating: resolvedRating,
    ingredientCount: recipe.ingredients.length,
    daysInLibrary: daysInLibrary(recipe.createdAt, nowMs),
  };
}

export const RECIPE_CRITERIA: RecipeCriterion[] = [
  {
    id: "daysSinceMade",
    label: "Days since last made",
    unit: "days",
    getValue: (metrics) => metrics.daysSinceMade,
    nullSide: "high",
    nullLabel: "Never",
    minDomainMax: 7,
    // Recently-made dishes cluster near the origin; the longer since a dish was
    // made, the more room it gets — so "made a while ago" recipes spread out
    // instead of piling up at the high end of a linear scale.
    warpPosition: (t) => t ** 2,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "rating",
    label: "Rating",
    unit: "stars",
    getValue: (metrics) => metrics.rating,
    nullSide: "low",
    nullLabel: "Unrated",
    hideNullOnPlot: true,
    fixedDomain: [1, 5],
    formatTick: (value) => `${Math.round(value)}★`,
  },
  {
    id: "timesMade",
    label: "Times made",
    unit: "times",
    getValue: (metrics) => metrics.timesMade,
    nullSide: null,
    nullLabel: null,
    minDomainMax: 4,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "ingredientCount",
    label: "Ingredient count",
    unit: "ingredients",
    getValue: (metrics) => metrics.ingredientCount,
    nullSide: null,
    nullLabel: null,
    minDomainMax: 5,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "daysInLibrary",
    label: "Days in library",
    unit: "days",
    getValue: (metrics) => metrics.daysInLibrary,
    nullSide: null,
    nullLabel: null,
    minDomainMax: 7,
    formatTick: (value) => `${Math.round(value)}`,
  },
];

export const CRITERIA_BY_ID = Object.fromEntries(
  RECIPE_CRITERIA.map((criterion) => [criterion.id, criterion])
) as Record<CriterionId, RecipeCriterion>;

export function isCriterionId(value: unknown): value is CriterionId {
  return typeof value === "string" && value in CRITERIA_BY_ID;
}

export type FilterOperator = "gte" | "lte";

export interface PoolFilter {
  id: string;
  criterionId: CriterionId;
  operator: FilterOperator;
  value: number;
}

// A null criterion value compares as if it sat past the criterion's null end:
// "days since made ≥ 3" keeps never-made recipes, "rating ≥ 4" drops unrated ones.
export function recipePassesFilter(
  metrics: RecipeMetrics,
  filter: PoolFilter
): boolean {
  const criterion = CRITERIA_BY_ID[filter.criterionId];
  if (!criterion) return true;

  const raw = criterion.getValue(metrics);
  const value =
    raw === null ? (criterion.nullSide === "high" ? Infinity : -Infinity) : raw;

  return filter.operator === "gte" ? value >= filter.value : value <= filter.value;
}
