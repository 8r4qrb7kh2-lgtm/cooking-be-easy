"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Flame } from "lucide-react";
import { CookLogEntry, Recipe } from "@/lib/types";
import { getRecipes } from "@/lib/storage";
import { getCookLogs } from "@/lib/cookLog";
import { todayKey, daysBetweenKeys } from "@/lib/mealPlan";
import { FREQUENCY_RANGES, FrequencyRange, buildCookFrequency } from "@/lib/cookFrequency";
import PageLoadingScreen from "@/components/PageLoadingScreen";
import CooksOverTimeChart from "@/components/CooksOverTimeChart";
import DishFrequencyGrid from "@/components/DishFrequencyGrid";

const INITIAL_ROWS = 15;

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 min-w-0">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p
        className="mt-1 truncate text-xl font-bold text-gray-900"
        style={{ fontVariantNumeric: "tabular-nums" }}
        title={value}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 truncate text-xs text-gray-400">{detail}</p>}
    </div>
  );
}

export default function HistoryPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [logs, setLogs] = useState<CookLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [range, setRange] = useState<FrequencyRange>("3m");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [loadedRecipes, loadedLogs] = await Promise.all([getRecipes(), getCookLogs()]);
        if (!mounted) return;
        setRecipes(loadedRecipes);
        setLogs(loadedLogs);
      } catch (error) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to load your cooking history.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const recipeNames = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe.name || "Untitled dish"])),
    [recipes]
  );

  const frequency = useMemo(
    () => buildCookFrequency(logs, recipeNames, range, todayKey()),
    [logs, recipeNames, range]
  );

  const hasAnyLogs = useMemo(() => logs.some((log) => recipeNames.has(log.recipeId)), [logs, recipeNames]);

  const weeks = Math.max(1, (daysBetweenKeys(frequency.startKey, frequency.endKey) + 1) / 7);
  const perWeek = frequency.totalCooks / weeks;
  const topDish = frequency.dishes[0];
  const visibleDishes = showAll ? frequency.dishes : frequency.dishes.slice(0, INITIAL_ROWS);
  const unit = frequency.bucketSize === "week" ? "week" : "month";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Cooking history</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          How often you make each dish, from the meals you&apos;ve logged
        </p>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <PageLoadingScreen />
      ) : !hasAnyLogs ? (
        <div className="py-20 text-center">
          <BarChart3 size={48} className="mx-auto mb-4 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-500">Nothing logged yet</h2>
          <p className="mx-auto mb-6 mt-1 max-w-sm text-sm text-gray-400">
            Each time you finish a dish in cooking mode and mark it as made, it shows up here.
          </p>
          <Link
            href="/cook"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
          >
            <Flame size={18} />
            Start cooking
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-5 inline-flex flex-wrap rounded-lg border border-gray-200 bg-white p-0.5">
            {FREQUENCY_RANGES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                aria-pressed={range === value}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  range === value ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Meals cooked" value={`${frequency.totalCooks}`} />
            <StatTile label="Different dishes" value={`${frequency.dishes.length}`} />
            <StatTile label="Per week" value={perWeek.toFixed(perWeek < 10 ? 1 : 0)} detail="on average" />
            <StatTile
              label="Most made"
              value={topDish ? topDish.name : "—"}
              detail={topDish ? `${topDish.total} time${topDish.total === 1 ? "" : "s"}` : undefined}
            />
          </div>

          {frequency.totalCooks === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
              No meals logged in this period. Try a longer range.
            </div>
          ) : (
            <>
              <section className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-900">Meals cooked per {unit}</h2>
                <div className="mt-3">
                  <CooksOverTimeChart
                    buckets={frequency.buckets}
                    totals={frequency.totals}
                    bucketSize={frequency.bucketSize}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-gray-900">How often you make each dish</h2>
                <p className="mb-3 text-xs text-gray-500">
                  Each square is one {unit}; darker means you made it more times. Most made first.
                </p>
                <DishFrequencyGrid
                  dishes={visibleDishes}
                  buckets={frequency.buckets}
                  bucketSize={frequency.bucketSize}
                />
                {frequency.dishes.length > INITIAL_ROWS && (
                  <button
                    type="button"
                    onClick={() => setShowAll((prev) => !prev)}
                    className="mt-3 text-sm font-medium text-brand-700 hover:text-brand-800"
                  >
                    {showAll ? "Show fewer" : `Show all ${frequency.dishes.length} dishes`}
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
