"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2, Star, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import StarRow from "./StarRow";
import CookTimeSlider from "./CookTimeSlider";
import { getCookLogs } from "@/lib/cookLog";
import { getRecipe } from "@/lib/storage";
import {
  getDisplayName,
  getMyRatedRecipeIds,
  getRatingsForRecipe,
  saveMyRating,
} from "@/lib/ratings";
import {
  DEFAULT_COOK_MINUTES,
  formatCookTime,
  getCookTimesForRecipe,
  saveMyCookTime,
} from "@/lib/cookTimes";
import { daysBetweenKeys, todayKey } from "@/lib/mealPlan";
import {
  getHandledRecipeIds,
  markRecipeRatingHandled,
} from "@/lib/ratingPrompts";

interface RatingCandidate {
  recipeId: string;
  cookedOn: string;
}

// Global "How was it?" prompt. Any dish the user logged cooking at least a day
// ago — however long ago that was — gets asked about the next time they open the
// app: how it tasted, and how long it took. Once per dish, ever. Mounted in the
// layout so it surfaces over whatever page they land on.
export default function RatingPrompt() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userName = getDisplayName(user);

  const [queue, setQueue] = useState<RatingCandidate[]>([]);
  // The loaded name + this user's existing rating/cook time, tagged with the
  // recipe they belong to so the modal only renders once THIS dish's data is in
  // (never a prior dish's).
  const [loaded, setLoaded] = useState<{
    recipeId: string;
    name: string;
    existingRating: number;
    existingMinutes: number | null;
  } | null>(null);
  // The stars the user has tapped for the active dish. Nothing is written until
  // they hit Apply, so a misclick can be corrected first. Reset per dish.
  const [selected, setSelected] = useState(0);
  // How long they say it took. Pre-filled (their previous answer, or the default)
  // and written alongside the rating on Apply.
  const [minutes, setMinutes] = useState(DEFAULT_COOK_MINUTES);
  const [saving, setSaving] = useState(false);

  // Recipe IDs this user has already dealt with — prompted about before (rated or
  // dismissed) or already rated anywhere — none of which should be asked about
  // again. Seeded from the DB on each refresh and added to the instant a user
  // rates/dismisses, so an in-flight write can never let a just-answered dish
  // reappear.
  const handledRef = useRef<Set<string>>(new Set());

  const current = queue[0] ?? null;

  // Gather every dish this user cooked at least a day ago that they haven't
  // already rated or been asked to rate — there's no cutoff, so a dish made
  // months back is still asked about the first time it comes up. Re-runs when the
  // app regains focus — todayKey() is re-read each time — so a PWA reopened the
  // next day still prompts without a hard reload. Never clobbers a prompt the
  // user is already partway through answering.
  useEffect(() => {
    if (!userId) {
      setQueue([]);
      return;
    }
    const uid = userId;
    handledRef.current = new Set();
    let active = true;

    async function refresh() {
      try {
        const [logs, handledIds, ratedIds] = await Promise.all([
          getCookLogs(),
          getHandledRecipeIds(),
          getMyRatedRecipeIds(),
        ]);
        if (!active) return;
        // A dish already rated is treated as handled too: the first rating
        // sticks, so we never ask again even if it was rated from the recipe page.
        handledIds.forEach((id) => handledRef.current.add(id));
        ratedIds.forEach((id) => handledRef.current.add(id));
        const today = todayKey();
        const seen = new Set<string>();
        const candidates: RatingCandidate[] = [];
        // Newest cook first: ask about what's freshest in memory, and when a dish
        // was made several times, label it with the most recent one.
        const mine = logs
          .filter((log) => log.userId === uid)
          .sort((a, b) => b.cookedOn.localeCompare(a.cookedOn));
        for (const log of mine) {
          const daysAgo = daysBetweenKeys(log.cookedOn, today);
          if (daysAgo < 1) continue;
          if (handledRef.current.has(log.recipeId)) continue;
          if (seen.has(log.recipeId)) continue;
          seen.add(log.recipeId);
          candidates.push({ recipeId: log.recipeId, cookedOn: log.cookedOn });
        }
        setQueue((prev) => (prev.length > 0 ? prev : candidates));
      } catch {
        // If cook logs / handled prompts can't be loaded we simply don't prompt.
      }
    }

    refresh();

    function onFocus() {
      refresh();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  // Load the recipe name + this user's existing rating and cook time for the
  // active dish. The result is tagged with current.recipeId; the render gate
  // below only shows the modal when that tag matches, so a tap can never land on
  // the wrong dish while the next one is still loading.
  useEffect(() => {
    if (!current || !userId) return;
    let cancelled = false;
    Promise.all([
      getRecipe(current.recipeId),
      getRatingsForRecipe(current.recipeId),
      getCookTimesForRecipe(current.recipeId),
    ])
      .then(([recipe, ratings, cookTimes]) => {
        if (cancelled) return;
        if (!recipe) {
          // Recipe was deleted — drop it and move to the next candidate.
          setQueue((q) => q.slice(1));
          return;
        }
        setLoaded({
          recipeId: current.recipeId,
          name: recipe.name,
          existingRating:
            ratings.find((rating) => rating.userId === userId)?.rating ?? 0,
          existingMinutes:
            cookTimes.find((cookTime) => cookTime.userId === userId)?.minutes ??
            null,
        });
      })
      .catch(() => {
        if (!cancelled) setQueue((q) => q.slice(1));
      });
    return () => {
      cancelled = true;
    };
  }, [current?.recipeId, current?.cookedOn, userId]);

  // Start each dish with a clean selection (or its existing answers, if any), so
  // a choice carried over from the previous prompt can't be applied by accident.
  useEffect(() => {
    setSelected(loaded?.existingRating ?? 0);
    setMinutes(loaded?.existingMinutes ?? DEFAULT_COOK_MINUTES);
  }, [loaded?.recipeId, loaded?.existingRating, loaded?.existingMinutes]);

  // Marks the dish as handled so it isn't asked about again, then advances.
  // The in-memory set is updated synchronously so a focus refresh can't re-add
  // it before the DB write lands; the write persists it across the user's devices.
  function finish() {
    if (current) {
      handledRef.current.add(current.recipeId);
      void markRecipeRatingHandled(current.recipeId, current.cookedOn).catch(
        () => {}
      );
    }
    setQueue((q) => q.slice(1));
  }

  // Commit the stars and the cook time the user settled on. Only reachable once
  // they've picked at least one star and pressed Apply.
  async function apply() {
    if (!current || !userId || saving || selected === 0) return;
    setSaving(true);
    try {
      await Promise.all([
        saveMyRating({
          recipeId: current.recipeId,
          userName,
          rating: selected,
        }),
        saveMyCookTime({ recipeId: current.recipeId, userName, minutes }),
      ]);
    } catch {
      // Even if saving fails we close so the user isn't nagged repeatedly.
    } finally {
      setSaving(false);
      finish();
    }
  }

  // Only render once the loaded data belongs to the current dish — this is what
  // prevents a stale name/stars (and a wrong-dish tap) during a queue advance.
  if (!current || loaded?.recipeId !== current.recipeId) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 px-4 pb-24 sm:pb-0">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-500">
            <Star size={20} className="fill-current" />
            <h2 className="text-base font-semibold text-gray-900">How was it?</h2>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Not now"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          You made{" "}
          <span className="font-medium text-gray-700">{loaded.name}</span>{" "}
          {daysAgoLabel(current.cookedOn)}. Tap a star to rate it.
        </p>
        <div className="mt-4 flex justify-center">
          <StarRow
            value={selected}
            size={36}
            interactive
            onSelect={setSelected}
          />
        </div>
        <p
          className="mt-2 text-center text-xs text-gray-400"
          aria-live="polite"
        >
          {selected > 0
            ? `${selected} star${selected === 1 ? "" : "s"} selected`
            : " "}
        </p>

        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-gray-500">
              <Clock size={14} className="text-gray-400" />
              How long did it take?
            </span>
            <span className="text-sm font-semibold text-gray-800">
              {formatCookTime(minutes)}
            </span>
          </div>
          <div className="mt-2">
            <CookTimeSlider
              minutes={minutes}
              onChange={setMinutes}
              disabled={saving}
              label="How long the dish took to cook"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            disabled={saving}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={selected === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Saving…
              </>
            ) : (
              "Apply"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Now that dishes are asked about however long after they were cooked, the label
// coarsens as it goes back — "83 days ago" reads worse than "3 months ago".
function daysAgoLabel(cookedOn: string): string {
  const daysAgo = daysBetweenKeys(cookedOn, todayKey());
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 14) return `${daysAgo} days ago`;
  if (daysAgo < 60) return `${Math.round(daysAgo / 7)} weeks ago`;
  if (daysAgo < 365) return `${Math.round(daysAgo / 30)} months ago`;
  return "over a year ago";
}
