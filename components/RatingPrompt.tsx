"use client";

import { useEffect, useState } from "react";
import { Loader2, Star, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import StarRow from "./StarRow";
import { getCookLogs } from "@/lib/cookLog";
import { getRecipe } from "@/lib/storage";
import {
  getDisplayName,
  getRatingsForRecipe,
  saveMyRating,
} from "@/lib/ratings";
import { daysBetweenKeys, todayKey } from "@/lib/mealPlan";
import {
  markRecipeRatingHandled,
  wasRatingPromptHandled,
} from "@/lib/ratingPrompts";

interface RatingCandidate {
  recipeId: string;
  cookedOn: string;
}

// Global "How was it?" prompt. When a user opens the app 1–2 days after they
// logged cooking a dish, this asks them to rate it — once per dish. Mounted in
// the layout so it surfaces over whatever page they land on.
export default function RatingPrompt() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userName = getDisplayName(user);

  const [queue, setQueue] = useState<RatingCandidate[]>([]);
  // The loaded name + existing rating, tagged with the recipe they belong to so
  // the modal only renders once THIS dish's data is in (never a prior dish's).
  const [loaded, setLoaded] = useState<{
    recipeId: string;
    name: string;
    existingRating: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const current = queue[0] ?? null;

  // Gather the dishes this user cooked 1–2 days ago that they haven't been
  // asked to rate yet (anything older than 2 days is skipped). Re-runs when the
  // app regains focus — todayKey() is re-read each time — so a PWA reopened the
  // next day still prompts without a hard reload. Never clobbers a prompt the
  // user is already partway through answering.
  useEffect(() => {
    if (!userId) {
      setQueue([]);
      return;
    }
    const uid = userId;
    let active = true;

    async function refresh() {
      try {
        const logs = await getCookLogs();
        if (!active) return;
        const today = todayKey();
        const seen = new Set<string>();
        const candidates: RatingCandidate[] = [];
        const mine = logs
          .filter((log) => log.userId === uid)
          .sort((a, b) => a.cookedOn.localeCompare(b.cookedOn));
        for (const log of mine) {
          const daysAgo = daysBetweenKeys(log.cookedOn, today);
          if (daysAgo !== 1 && daysAgo !== 2) continue;
          if (wasRatingPromptHandled(uid, log.recipeId, log.cookedOn)) continue;
          if (seen.has(log.recipeId)) continue;
          seen.add(log.recipeId);
          candidates.push({ recipeId: log.recipeId, cookedOn: log.cookedOn });
        }
        setQueue((prev) => (prev.length > 0 ? prev : candidates));
      } catch {
        // If cook logs can't be loaded we simply don't prompt.
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

  // Load the recipe name + this user's existing rating for the active dish. The
  // result is tagged with current.recipeId; the render gate below only shows the
  // modal when that tag matches, so a tap can never land on the wrong dish while
  // the next one is still loading.
  useEffect(() => {
    if (!current || !userId) return;
    let cancelled = false;
    Promise.all([
      getRecipe(current.recipeId),
      getRatingsForRecipe(current.recipeId),
    ])
      .then(([recipe, ratings]) => {
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
        });
      })
      .catch(() => {
        if (!cancelled) setQueue((q) => q.slice(1));
      });
    return () => {
      cancelled = true;
    };
  }, [current?.recipeId, current?.cookedOn, userId]);

  // Marks the dish as handled so it isn't asked about again, then advances.
  function finish() {
    if (current && userId) markRecipeRatingHandled(userId, current.recipeId);
    setQueue((q) => q.slice(1));
  }

  async function rate(star: number) {
    if (!current || !userId || saving) return;
    setSaving(true);
    try {
      await saveMyRating({ recipeId: current.recipeId, userName, rating: star });
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
            value={loaded.existingRating}
            size={36}
            interactive
            onSelect={rate}
          />
        </div>
        <div className="mt-4 flex items-center justify-center">
          {saving ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Saving…
            </span>
          ) : (
            <button
              type="button"
              onClick={finish}
              className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Not now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function daysAgoLabel(cookedOn: string): string {
  const daysAgo = daysBetweenKeys(cookedOn, todayKey());
  return daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
}
