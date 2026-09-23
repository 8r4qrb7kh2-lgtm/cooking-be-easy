import { CookLogEntry } from "./types";
import {
  addDaysToKey,
  daysBetweenKeys,
  parseDateKey,
  startOfWeekKey,
  toDateKey,
} from "./mealPlan";

// Turns cook logs into "how often do I make each dish" over time: the logs are
// bucketed into weeks or months across the chosen range, per dish and in total.

export type FrequencyRange = "3m" | "6m" | "12m" | "all";
export type BucketSize = "week" | "month";

export const FREQUENCY_RANGES: Array<{ value: FrequencyRange; label: string }> = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "all", label: "All time" },
];

export interface FrequencyBucket {
  key: string; // first day of the bucket, YYYY-MM-DD
  label: string; // short axis label
  longLabel: string; // tooltip label
}

export interface DishFrequency {
  recipeId: string;
  name: string;
  total: number; // cooks inside the range
  counts: number[]; // per bucket, aligned with FrequencyResult.buckets
  lastCooked: string; // YYYY-MM-DD, within the range
  avgDaysBetween: number | null; // null with fewer than two cooks
}

export interface FrequencyResult {
  bucketSize: BucketSize;
  buckets: FrequencyBucket[];
  totals: number[]; // all dishes per bucket
  dishes: DishFrequency[]; // most-cooked first
  totalCooks: number;
  startKey: string;
  endKey: string;
}

function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function addMonthsToKey(key: string, months: number): string {
  const date = parseDateKey(key);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return toDateKey(date);
}

function rangeStartKey(range: FrequencyRange, today: string, earliest: string): string {
  if (range === "all") return earliest < today ? earliest : today;
  const months = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  const date = parseDateKey(today);
  date.setMonth(date.getMonth() - months);
  return toDateKey(date);
}

function bucketLabels(key: string, size: BucketSize, spansYears: boolean) {
  const date = parseDateKey(key);
  if (size === "month") {
    return {
      label: date.toLocaleDateString(undefined, spansYears ? { month: "short", year: "2-digit" } : { month: "short" }),
      longLabel: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }
  return {
    label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    longLabel: `Week of ${date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
  };
}

export function buildCookFrequency(
  logs: CookLogEntry[],
  recipeNames: Map<string, string>,
  range: FrequencyRange,
  today: string
): FrequencyResult {
  // Logs for recipes that have since been deleted have nothing to link to.
  const known = logs.filter((log) => recipeNames.has(log.recipeId) && log.cookedOn <= today);
  const earliest = known.reduce((min, log) => (log.cookedOn < min ? log.cookedOn : min), today);
  const startKey = rangeStartKey(range, today, earliest);
  const inRange = known.filter((log) => log.cookedOn >= startKey);

  // Weekly columns stay readable up to about half a year; beyond that, months.
  const bucketSize: BucketSize = daysBetweenKeys(startKey, today) <= 190 ? "week" : "month";
  const bucketStart = bucketSize === "week" ? startOfWeekKey : startOfMonthKey;
  const nextBucket = (key: string) =>
    bucketSize === "week" ? addDaysToKey(key, 7) : addMonthsToKey(key, 1);

  const spansYears = startKey.slice(0, 4) !== today.slice(0, 4);
  const buckets: FrequencyBucket[] = [];
  const indexByKey = new Map<string, number>();
  for (let key = bucketStart(startKey); key <= today; key = nextBucket(key)) {
    indexByKey.set(key, buckets.length);
    buckets.push({ key, ...bucketLabels(key, bucketSize, spansYears) });
  }

  const totals = buckets.map(() => 0);
  const byRecipe = new Map<string, { counts: number[]; dates: string[] }>();
  for (const log of inRange) {
    const index = indexByKey.get(bucketStart(log.cookedOn));
    if (index === undefined) continue;
    let entry = byRecipe.get(log.recipeId);
    if (!entry) {
      entry = { counts: buckets.map(() => 0), dates: [] };
      byRecipe.set(log.recipeId, entry);
    }
    entry.counts[index] += 1;
    entry.dates.push(log.cookedOn);
    totals[index] += 1;
  }

  const dishes: DishFrequency[] = [...byRecipe.entries()].map(([recipeId, entry]) => {
    // Several household members can log the same dish on one day; count the day once.
    const dates = [...new Set(entry.dates)].sort();
    const gaps = dates.length > 1 ? daysBetweenKeys(dates[0], dates[dates.length - 1]) / (dates.length - 1) : null;
    return {
      recipeId,
      name: recipeNames.get(recipeId) ?? "Untitled dish",
      total: entry.counts.reduce((sum, count) => sum + count, 0),
      counts: entry.counts,
      lastCooked: dates[dates.length - 1],
      avgDaysBetween: gaps,
    };
  });

  dishes.sort(
    (a, b) =>
      b.total - a.total ||
      b.lastCooked.localeCompare(a.lastCooked) ||
      a.name.localeCompare(b.name)
  );

  return {
    bucketSize,
    buckets,
    totals,
    dishes,
    totalCooks: inRange.length,
    startKey,
    endKey: today,
  };
}
