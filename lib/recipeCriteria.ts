import { Recipe } from "./types";
import { RecipeMealStats } from "./mealPlan";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CriterionId =
  | "daysSinceMade"
  | "rating"
  | "timesMade"
  | "ingredientCount"
  | "daysInLibrary";

export interface RecipeCriterion {
  id: CriterionId;
  label: string;
  unit: string;
  // null = the recipe has no value for this criterion (never made / unrated)
  getValue: (recipe: Recipe, stats: RecipeMealStats) => number | null;
  // Which end of the scale a null value conceptually sits at: never-made is
  // beyond the oldest "days since made", unrated is below every rating.
  nullSide: "low" | "high" | null;
  nullLabel: string | null;
  fixedDomain?: [number, number];
  // Floor for the auto-computed domain max so sparse data still gets a usable axis
  minDomainMax?: number;
  formatTick: (value: number) => string;
}

function daysInLibrary(recipe: Recipe): number {
  const created = Date.parse(recipe.createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / DAY_MS));
}

export const RECIPE_CRITERIA: RecipeCriterion[] = [
  {
    id: "daysSinceMade",
    label: "Days since last made",
    unit: "days",
    getValue: (_recipe, stats) => stats.daysSinceMade,
    nullSide: "high",
    nullLabel: "Never",
    minDomainMax: 7,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "rating",
    label: "Rating",
    unit: "stars",
    getValue: (recipe) => recipe.rating ?? null,
    nullSide: "low",
    nullLabel: "Unrated",
    fixedDomain: [1, 5],
    formatTick: (value) => `${Math.round(value)}★`,
  },
  {
    id: "timesMade",
    label: "Times made",
    unit: "times",
    getValue: (_recipe, stats) => stats.timesMade,
    nullSide: null,
    nullLabel: null,
    minDomainMax: 4,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "ingredientCount",
    label: "Ingredient count",
    unit: "ingredients",
    getValue: (recipe) => recipe.ingredients.length,
    nullSide: null,
    nullLabel: null,
    minDomainMax: 5,
    formatTick: (value) => `${Math.round(value)}`,
  },
  {
    id: "daysInLibrary",
    label: "Days in library",
    unit: "days",
    getValue: (recipe) => daysInLibrary(recipe),
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
  recipe: Recipe,
  stats: RecipeMealStats,
  filter: PoolFilter
): boolean {
  const criterion = CRITERIA_BY_ID[filter.criterionId];
  if (!criterion) return true;

  const raw = criterion.getValue(recipe, stats);
  const value =
    raw === null ? (criterion.nullSide === "high" ? Infinity : -Infinity) : raw;

  return filter.operator === "gte" ? value >= filter.value : value <= filter.value;
}
