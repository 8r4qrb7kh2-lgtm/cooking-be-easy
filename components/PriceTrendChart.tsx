"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PriceMode,
  PricePoint,
  formatAxisValue,
  formatModeValue,
  formatPointDate,
  toModeValue,
} from "@/lib/priceHistory";

/**
 * Categorical series colors, assigned in fixed slot order and never cycled.
 * Validated for colorblind separation and lightness on a white surface; the
 * three lighter hues sit below 3:1 contrast, which the always-present legend
 * and the data table cover (identity is never carried by color alone).
 */
export const SERIES_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
];

export const MAX_SERIES = SERIES_COLORS.length;

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  unitLabel: string;
  points: PricePoint[];
}

const PAD = { top: 14, right: 18, bottom: 30, left: 58 };
const DAY_MS = 24 * 60 * 60 * 1000;

function niceScale(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / Math.max(1, count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    // Re-round each step to kill floating-point drift like 0.30000000000000004.
    ticks.push(Math.round(value / step) * step);
  }
  return { ticks, min: niceMin, max: niceMax };
}

export default function PriceTrendChart({
  series,
  mode,
}: {
  series: ChartSeries[];
  mode: PriceMode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverDate, setHoverDate] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 520 ? 240 : 300;
  const plotWidth = Math.max(80, width - PAD.left - PAD.right);
  const plotHeight = Math.max(80, height - PAD.top - PAD.bottom);

  const plotted = useMemo(
    () =>
      series
        .filter((entry) => entry.points.length > 0)
        .map((entry) => {
          const baseline = entry.points[0].pricePerUnit;
          return {
            ...entry,
            values: entry.points.map((point) => ({
              date: point.date,
              y: toModeValue(point.pricePerUnit, baseline, mode),
              point,
            })),
          };
        }),
    [series, mode]
  );

  const dates = useMemo(
    () => [...new Set(plotted.flatMap((entry) => entry.values.map((value) => value.date)))].sort((a, b) => a - b),
    [plotted]
  );

  const xDomain = useMemo(() => {
    if (dates.length === 0) return { min: 0, max: 1 };
    const min = dates[0];
    const max = dates[dates.length - 1];
    if (min === max) return { min: min - DAY_MS, max: max + DAY_MS };
    return { min, max };
  }, [dates]);

  const spansYears = xDomain.max - xDomain.min > 330 * DAY_MS;

  const yScale = useMemo(() => {
    const values = plotted.flatMap((entry) => entry.values.map((value) => value.y));
    if (values.length === 0) return niceScale(0, 1);
    let min = Math.min(...values);
    let max = Math.max(...values);
    // Change modes are read against zero, so the baseline is always on screen.
    if (mode !== "price") {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    } else {
      min = Math.min(min, max * 0.9);
    }
    return niceScale(min, max);
  }, [plotted, mode]);

  const toX = (date: number) =>
    PAD.left + ((date - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
  const toY = (value: number) =>
    PAD.top + plotHeight - ((value - yScale.min) / (yScale.max - yScale.min)) * plotHeight;

  // Label the real purchase dates when they fit, otherwise fall back to evenly
  // spaced ticks. Either way the count is capped by how wide a label is, so
  // "Feb 14" and "Mar 8" never collide on a phone.
  const xTicks = useMemo(() => {
    if (dates.length === 0) return [];
    const labelWidth = spansYears ? 96 : 72;
    const maxLabels = Math.max(2, Math.min(6, Math.floor(plotWidth / labelWidth)));
    if (dates.length <= maxLabels) return dates;
    const step = (xDomain.max - xDomain.min) / (maxLabels - 1);
    return Array.from({ length: maxLabels }, (_, index) => xDomain.min + index * step);
  }, [dates, plotWidth, spansYears, xDomain]);

  const hovered = useMemo(() => {
    if (hoverDate === null) return null;
    const rows = plotted
      .map((entry) => {
        const match = entry.values.find((value) => value.date === hoverDate);
        return match ? { entry, value: match } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    if (rows.length === 0) return null;
    return { date: hoverDate, rows };
  }, [hoverDate, plotted]);

  function handlePointer(event: React.PointerEvent<SVGSVGElement>) {
    if (dates.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const target = xDomain.min + ((x - PAD.left) / plotWidth) * (xDomain.max - xDomain.min);
    let nearest = dates[0];
    for (const date of dates) {
      if (Math.abs(date - target) < Math.abs(nearest - target)) nearest = date;
    }
    setHoverDate(nearest);
  }

  const summary = plotted
    .map((entry) => `${entry.name} in ${formatModeValue(entry.values[entry.values.length - 1].y, mode)}`)
    .join("; ");

  const tooltipX = hovered ? toX(hovered.date) : 0;
  const tooltipOnLeft = tooltipX > PAD.left + plotWidth * 0.6;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Price over time. ${summary}`}
        className="touch-none select-none"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setHoverDate(null)}
      >
        {/* Gridlines — hairline, recessive, behind everything */}
        {yScale.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotWidth}
              y1={toY(tick)}
              y2={toY(tick)}
              stroke={mode !== "price" && tick === 0 ? "#9ca3af" : "#e8ebe8"}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={toY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-gray-500"
              style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {formatAxisValue(tick, mode)}
            </text>
          </g>
        ))}

        {xTicks.map((tick, index) => (
          <text
            key={`${tick}-${index}`}
            x={Math.min(Math.max(toX(tick), PAD.left + 12), PAD.left + plotWidth - 12)}
            y={PAD.top + plotHeight + 18}
            textAnchor="middle"
            className="fill-gray-500"
            style={{ fontSize: 11 }}
          >
            {formatPointDate(tick, spansYears)}
          </text>
        ))}

        {/* Crosshair sits under the marks so it never covers a dot */}
        {hovered && (
          <line
            x1={toX(hovered.date)}
            x2={toX(hovered.date)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
            stroke="#9ca3af"
            strokeWidth={1}
          />
        )}

        {plotted.map((entry) => (
          <g key={entry.key}>
            <path
              d={entry.values
                .map((value, index) => `${index === 0 ? "M" : "L"} ${toX(value.date)} ${toY(value.y)}`)
                .join(" ")}
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {entry.values.map((value) => (
              <circle
                key={value.date}
                cx={toX(value.date)}
                cy={toY(value.y)}
                r={hovered?.date === value.date ? 5.5 : 4}
                fill={entry.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{
            left: tooltipOnLeft ? undefined : Math.min(tooltipX + 12, width - 12),
            right: tooltipOnLeft ? Math.max(width - tooltipX + 12, 12) : undefined,
            top: PAD.top,
            maxWidth: Math.max(160, width * 0.55),
          }}
        >
          <p className="text-[11px] font-medium text-gray-500">
            {formatPointDate(hovered.date, true)}
          </p>
          <ul className="mt-1 space-y-1">
            {hovered.rows.map(({ entry, value }) => (
              <li key={entry.key} className="flex items-baseline gap-2">
                <span
                  className="mt-1 h-0.5 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span
                  className="text-sm font-semibold text-gray-900"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatModeValue(value.y, mode)}
                </span>
                <span className="truncate text-xs text-gray-500">{entry.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
