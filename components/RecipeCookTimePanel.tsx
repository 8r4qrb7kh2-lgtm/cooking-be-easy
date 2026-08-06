"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { RecipeCookTime } from "@/lib/types";
import {
  DEFAULT_COOK_MINUTES,
  averageCookMinutes,
  formatCookTime,
  getCookTimesForRecipe,
  saveMyCookTime,
} from "@/lib/cookTimes";
import { getDisplayName } from "@/lib/ratings";
import { useAuth } from "./AuthProvider";
import CookTimeSlider from "./CookTimeSlider";

// Writes trail the slider by this much so dragging it doesn't fire a request per step.
const SAVE_DEBOUNCE_MS = 500;

export default function RecipeCookTimePanel({ recipeId }: { recipeId: string }) {
  const { user } = useAuth();
  const [cookTimes, setCookTimes] = useState<RecipeCookTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = user?.id ?? null;
  const myName = getDisplayName(user);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getCookTimesForRecipe(recipeId)
      .then((loaded) => {
        if (mounted) setCookTimes(loaded);
      })
      .catch(() => {
        // No cook times to show if the load fails — the slider still works.
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [recipeId]);

  // Drop a pending write when the panel unmounts or switches recipe.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [recipeId]);

  const myMinutes =
    cookTimes.find((cookTime) => cookTime.userId === myId)?.minutes ?? null;
  const average = averageCookMinutes(cookTimes);

  // Moving the slider updates the list optimistically, then persists once the
  // user stops dragging.
  function setMyMinutes(minutes: number) {
    if (!myId) return;

    setCookTimes((prev) => [
      ...prev.filter((cookTime) => cookTime.userId !== myId),
      { recipeId, userId: myId, userName: myName, minutes },
    ]);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const fresh = await saveMyCookTime({ recipeId, userName: myName, minutes });
        setCookTimes(fresh);
      } catch {
        // Keep the optimistic value on screen; the next change retries the write.
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
  }

  const otherTimes = cookTimes
    .filter((cookTime) => cookTime.userId !== myId)
    .sort((a, b) =>
      (a.userName ?? "").localeCompare(b.userName ?? "", undefined, {
        sensitivity: "base",
      })
    );

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-700">Cook time</p>
        {average !== null && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <Clock size={12} className="text-brand-600" />
            <span className="font-semibold text-gray-700">
              {formatCookTime(average)}
            </span>
            avg · {cookTimes.length} report{cookTimes.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          {myMinutes === null
            ? "You haven't recorded a time — drag to set one"
            : "Your time"}
        </span>
        <span className="flex items-center gap-1.5">
          {saving && <Loader2 size={12} className="animate-spin text-gray-400" />}
          <span className="text-sm font-semibold text-gray-800">
            {myMinutes === null ? "--" : formatCookTime(myMinutes)}
          </span>
        </span>
      </div>

      <div className="mt-1.5">
        <CookTimeSlider
          minutes={myMinutes ?? DEFAULT_COOK_MINUTES}
          onChange={setMyMinutes}
          disabled={!myId}
          label="Your cook time for this recipe"
        />
      </div>

      {loading ? (
        <p className="mt-2 text-xs text-gray-400">Loading cook times…</p>
      ) : (
        otherTimes.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-medium text-gray-400">Household times</p>
            {otherTimes.map((cookTime) => (
              <div
                key={cookTime.userId}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate text-sm text-gray-600">
                  {cookTime.userName ?? "Household member"}
                </span>
                <span className="text-sm text-gray-700">
                  {formatCookTime(cookTime.minutes)}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
