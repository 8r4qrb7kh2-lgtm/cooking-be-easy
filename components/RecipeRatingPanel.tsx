"use client";

import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { RecipeRating } from "@/lib/types";
import {
  averageRating,
  getDisplayName,
  getRatingsForRecipe,
  saveMyRating,
} from "@/lib/ratings";
import { useAuth } from "./AuthProvider";

interface RecipeRatingPanelProps {
  recipeId: string;
  // Reports the new cached average (rounded) so the parent can keep recipe.rating in sync.
  onAverageChange?: (average: number | null) => void;
}

function StarRow({
  value,
  size,
  interactive,
  onSelect,
}: {
  value: number;
  size: number;
  interactive?: boolean;
  onSelect?: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= value;
        const starEl = (
          <Star
            size={size}
            fill={filled ? "currentColor" : "none"}
            className={filled ? "text-amber-500" : "text-gray-300"}
          />
        );
        if (!interactive) {
          return <span key={star}>{starEl}</span>;
        }
        return (
          <button
            key={star}
            type="button"
            onClick={() => onSelect?.(star)}
            className="p-0.5 rounded-md transition-transform hover:scale-110"
            aria-label={`Set your rating to ${star} star${star === 1 ? "" : "s"}`}
            title={`Set your rating to ${star} star${star === 1 ? "" : "s"}`}
          >
            {starEl}
          </button>
        );
      })}
    </div>
  );
}

export default function RecipeRatingPanel({
  recipeId,
  onAverageChange,
}: RecipeRatingPanelProps) {
  const { user } = useAuth();
  const [ratings, setRatings] = useState<RecipeRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const myId = user?.id ?? null;
  const myName = getDisplayName(user);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getRatingsForRecipe(recipeId)
      .then((loaded) => {
        if (mounted) setRatings(loaded);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [recipeId]);

  const myRating = ratings.find((rating) => rating.userId === myId)?.rating ?? 0;
  const average = averageRating(ratings);

  async function setMyStars(star: number) {
    if (!myId || saving) return;
    const nextRating = star === myRating ? null : star;

    // Optimistic update so the stars respond immediately.
    const optimistic = ratings.filter((rating) => rating.userId !== myId);
    if (nextRating !== null) {
      optimistic.push({
        recipeId,
        userId: myId,
        userName: myName,
        rating: nextRating,
      });
    }
    setRatings(optimistic);
    onAverageChange?.(roundedAverage(optimistic));

    setSaving(true);
    try {
      const fresh = await saveMyRating({ recipeId, userName: myName, rating: nextRating });
      setRatings(fresh);
      onAverageChange?.(roundedAverage(fresh));
    } finally {
      setSaving(false);
    }
  }

  const otherRatings = ratings
    .filter((rating) => rating.userId !== myId)
    .sort((a, b) =>
      (a.userName ?? "").localeCompare(b.userName ?? "", undefined, { sensitivity: "base" })
    );

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">Your rating</p>
        {average !== null && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Star size={12} className="text-amber-500 fill-current" />
            <span className="font-semibold text-gray-700">{average.toFixed(1)}</span>
            avg · {ratings.length} rating{ratings.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <StarRow value={myRating} size={22} interactive onSelect={setMyStars} />
        {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-gray-400">Loading ratings…</p>
      ) : (
        otherRatings.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-400">Household ratings</p>
            {otherRatings.map((rating) => (
              <div
                key={rating.userId}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-sm text-gray-600 truncate">
                  {rating.userName ?? "Household member"}
                </span>
                <StarRow value={rating.rating} size={14} />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function roundedAverage(ratings: RecipeRating[]): number | null {
  const average = averageRating(ratings);
  return average === null ? null : Math.round(average);
}
