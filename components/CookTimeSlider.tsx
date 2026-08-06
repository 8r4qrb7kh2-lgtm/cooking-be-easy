"use client";

import {
  COOK_MINUTES_STEP,
  MAX_COOK_MINUTES,
  MIN_COOK_MINUTES,
  formatCookTime,
} from "@/lib/cookTimes";

// Slider for "how long did this take to cook?", in 5-minute steps up to 4 hours.
// Shared by the post-cook rating prompt and the recipe page.
export default function CookTimeSlider({
  minutes,
  onChange,
  disabled,
  label = "Cook time",
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div>
      <input
        type="range"
        min={MIN_COOK_MINUTES}
        max={MAX_COOK_MINUTES}
        step={COOK_MINUTES_STEP}
        value={minutes}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={formatCookTime(minutes)}
        className="w-full cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{formatCookTime(MIN_COOK_MINUTES)}</span>
        <span>{formatCookTime(MAX_COOK_MINUTES)}</span>
      </div>
    </div>
  );
}
