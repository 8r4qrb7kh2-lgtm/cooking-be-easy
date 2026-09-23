"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BucketSize, FrequencyBucket } from "@/lib/cookFrequency";

const PAD = { top: 12, right: 8, bottom: 26, left: 30 };
const BAR_COLOR = "#16a34a"; // brand-600

function niceMax(value: number): { max: number; step: number } {
  if (value <= 4) return { max: Math.max(1, value), step: 1 };
  const rawStep = value / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return { max: Math.ceil(value / step) * step, step };
}

// Total meals cooked per week or month: one series, so no legend — the card
// title names it. Hovering (or tapping) a bar shows its exact count.
export default function CooksOverTimeChart({
  buckets,
  totals,
  bucketSize,
}: {
  buckets: FrequencyBucket[];
  totals: number[];
  bucketSize: BucketSize;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

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

  const height = width < 520 ? 170 : 200;
  const plotWidth = Math.max(60, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;
  const slot = plotWidth / Math.max(1, buckets.length);
  const gap = Math.min(6, Math.max(2, slot * 0.25));
  const barWidth = Math.max(2, slot - gap);

  const scale = useMemo(() => niceMax(Math.max(0, ...totals)), [totals]);
  const ticks = useMemo(() => {
    const values: number[] = [];
    for (let value = 0; value <= scale.max; value += scale.step) values.push(value);
    return values;
  }, [scale]);

  const toY = (value: number) => PAD.top + plotHeight - (value / scale.max) * plotHeight;

  // Label every nth bar so labels never collide on a phone.
  const labelEvery = Math.max(1, Math.ceil(54 / slot));

  function handlePointer(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left - PAD.left) / slot);
    setHover(index >= 0 && index < buckets.length ? index : null);
  }

  const hoveredX = hover === null ? 0 : PAD.left + hover * slot + slot / 2;
  const unit = bucketSize === "week" ? "week" : "month";

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Meals cooked per ${unit}: ${totals.reduce((a, b) => a + b, 0)} in total`}
        className="touch-none select-none"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotWidth}
              y1={toY(tick)}
              y2={toY(tick)}
              stroke={tick === 0 ? "#cbd5c9" : "#e8ebe8"}
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
              {tick}
            </text>
          </g>
        ))}

        {buckets.map((bucket, index) => {
          const value = totals[index];
          const x = PAD.left + index * slot + gap / 2;
          const top = toY(value);
          const barHeight = PAD.top + plotHeight - top;
          const radius = Math.min(4, barWidth / 2, barHeight);
          return (
            <g key={bucket.key}>
              {value > 0 && (
                <path
                  d={`M ${x} ${top + barHeight} V ${top + radius} Q ${x} ${top} ${x + radius} ${top} H ${
                    x + barWidth - radius
                  } Q ${x + barWidth} ${top} ${x + barWidth} ${top + radius} V ${top + barHeight} Z`}
                  fill={BAR_COLOR}
                  opacity={hover === null || hover === index ? 1 : 0.45}
                />
              )}
              {index % labelEvery === 0 && (
                <text
                  x={PAD.left + index * slot + slot / 2}
                  y={PAD.top + plotHeight + 17}
                  textAnchor={index === 0 && labelEvery > 1 ? "start" : "middle"}
                  className="fill-gray-500"
                  style={{ fontSize: 11 }}
                >
                  {bucket.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{
            top: 0,
            left: hoveredX > width * 0.6 ? undefined : Math.min(hoveredX + 10, width - 140),
            right: hoveredX > width * 0.6 ? Math.max(width - hoveredX + 10, 4) : undefined,
          }}
        >
          <p className="text-[11px] font-medium text-gray-500">{buckets[hover].longLabel}</p>
          <p className="text-sm font-semibold text-gray-900" style={{ fontVariantNumeric: "tabular-nums" }}>
            {totals[hover]} meal{totals[hover] === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}
