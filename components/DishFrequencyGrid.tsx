"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BucketSize, DishFrequency, FrequencyBucket } from "@/lib/cookFrequency";

// One green, light -> dark: how many times a dish was made in that week/month.
// Empty periods recede into the surface.
const EMPTY = "#eef2ee";
const STEPS = ["#86efac", "#22c55e", "#15803d", "#14532d"]; // 1, 2, 3, 4+

function cellColor(count: number): string {
  if (count <= 0) return EMPTY;
  return STEPS[Math.min(count, STEPS.length) - 1];
}

function formatDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }
  );
}

function describeCadence(dish: DishFrequency, bucketSize: BucketSize): string {
  if (dish.avgDaysBetween === null) return "Once";
  const days = dish.avgDaysBetween;
  if (days < 1.5) return "Daily";
  if (days < 10) return `Every ${Math.round(days)} days`;
  if (bucketSize === "week" || days < 45) return `Every ${Math.round(days / 7)} wk`;
  return `Every ${Math.round(days / 30)} mo`;
}

interface HoverCell {
  dish: DishFrequency;
  index: number;
}

export default function DishFrequencyGrid({
  dishes,
  buckets,
  bucketSize,
}: {
  dishes: DishFrequency[];
  buckets: FrequencyBucket[];
  bucketSize: BucketSize;
}) {
  const [hover, setHover] = useState<HoverCell | null>(null);
  const [width, setWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxTotal = Math.max(1, ...dishes.map((dish) => dish.total));

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Size the squares to fill the card; below the minimum the grid scrolls
  // sideways instead, starting at the most recent period.
  const narrow = width > 0 && width < 520;
  const nameWidth = narrow ? 96 : 188;
  const totalWidth = narrow ? 36 : 96;
  const fit = width > 0 ? Math.floor((width - nameWidth - totalWidth - 8) / Math.max(1, buckets.length)) - 3 : 16;
  const cell = Math.max(8, Math.min(26, fit));
  const labelEvery = Math.max(1, Math.ceil(44 / (cell + 3)));

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [buckets, cell]);

  const readout = hover
    ? `${hover.dish.name} · ${buckets[hover.index].longLabel}: ${hover.dish.counts[hover.index]}×`
    : null;

  return (
    <div>
      {/* Readout line doubles as the tooltip, so it works under a finger too */}
      <div className="mb-2 flex min-h-[20px] flex-wrap items-center justify-between gap-2">
        <p className="truncate text-xs text-gray-600" style={{ fontVariantNumeric: "tabular-nums" }}>
          {readout ?? "Hover or tap a square to see the count"}
        </p>
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((count) => (
            <span
              key={count}
              title={count === 4 ? "4+ times" : `${count} time${count === 1 ? "" : "s"}`}
              className="h-3 w-3 rounded-[3px]"
              style={{ backgroundColor: cellColor(count) }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto" onPointerLeave={() => setHover(null)}>
        <table className="border-separate" style={{ borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white" />
              {buckets.map((bucket, index) => (
                <th key={bucket.key} className="p-0 align-bottom font-normal">
                  <div
                    className="relative h-5 overflow-visible whitespace-nowrap text-left text-[10px] text-gray-500"
                    style={{ width: cell + 3 }}
                  >
                    {index % labelEvery === 0 ? bucket.label : ""}
                  </div>
                </th>
              ))}
              <th className="pl-2 text-right text-[11px] font-medium text-gray-500">Total</th>
            </tr>
          </thead>
          <tbody>
            {dishes.map((dish) => (
              <tr key={dish.recipeId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white py-0.5 pr-3 text-left font-normal"
                >
                  <Link
                    href={`/recipes/${dish.recipeId}`}
                    className="block truncate text-sm text-gray-800 hover:text-brand-700"
                    style={{ width: nameWidth - 12 }}
                    title={dish.name}
                  >
                    {dish.name}
                  </Link>
                  <span className="block truncate text-[11px] text-gray-400" style={{ width: nameWidth - 12 }}>
                    {describeCadence(dish, bucketSize)}
                    {!narrow && ` · last ${formatDay(dish.lastCooked)}`}
                  </span>
                </th>
                {dish.counts.map((count, index) => {
                  const active = hover?.dish.recipeId === dish.recipeId && hover.index === index;
                  return (
                    <td key={buckets[index].key} className="p-0 align-middle">
                      <button
                        type="button"
                        aria-label={`${dish.name}, ${buckets[index].longLabel}: ${count} time${
                          count === 1 ? "" : "s"
                        }`}
                        onPointerEnter={() => setHover({ dish, index })}
                        onFocus={() => setHover({ dish, index })}
                        onClick={() => setHover({ dish, index })}
                        className="flex items-center justify-center"
                        style={{ width: cell + 3, height: cell + 3 }}
                      >
                        <span
                          className="block rounded-[3px]"
                          style={{
                            width: cell,
                            height: cell,
                            backgroundColor: cellColor(count),
                            boxShadow: active ? "0 0 0 2px #ffffff, 0 0 0 3.5px #162114" : undefined,
                          }}
                        />
                      </button>
                    </td>
                  );
                })}
                <td className="pl-2 align-middle">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`h-1.5 w-14 overflow-hidden rounded-full bg-gray-100 ${narrow ? "hidden" : ""}`}>
                      <span
                        className="block h-full rounded-full bg-brand-600"
                        style={{ width: `${(dish.total / maxTotal) * 100}%` }}
                      />
                    </span>
                    <span
                      className="w-6 text-right text-sm font-semibold text-gray-900"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {dish.total}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
