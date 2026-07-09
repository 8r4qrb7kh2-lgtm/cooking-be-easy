"use client";

import { Star } from "lucide-react";

// A row of five stars. Read-only by default; pass `interactive` + `onSelect`
// to let the user click a star to choose a rating.
export default function StarRow({
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
