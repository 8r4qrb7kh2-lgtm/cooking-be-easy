"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, LineChart, Search, X } from "lucide-react";
import { Receipt } from "@/lib/types";
import {
  ItemPriceSeries,
  PriceMode,
  buildItemPriceSeries,
  formatModeValue,
  formatPointDate,
  formatUsd,
  toModeValue,
} from "@/lib/priceHistory";
import PriceTrendChart, { MAX_SERIES, SERIES_COLORS } from "@/components/PriceTrendChart";

const MODES: Array<{ value: PriceMode; label: string }> = [
  { value: "price", label: "Price" },
  { value: "dollar", label: "$ change" },
  { value: "percent", label: "% change" },
];

interface Picked {
  keys: string[];
  /** key -> color slot, kept stable so removing one item never repaints the others. */
  slots: Record<string, number>;
}

export default function PriceTrendPanel({ receipts }: { receipts: Receipt[] }) {
  const [mode, setMode] = useState<PriceMode>("price");
  const [picked, setPicked] = useState<Picked>({ keys: [], slots: {} });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showTable, setShowTable] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);

  const allSeries = useMemo(() => buildItemPriceSeries(receipts), [receipts]);

  const seriesByKey = useMemo(() => {
    const map = new Map<string, ItemPriceSeries>();
    for (const entry of allSeries) map.set(entry.key, entry);
    return map;
  }, [allSeries]);

  // Start on the most-bought items that actually have a trend to show.
  useEffect(() => {
    if (seededRef.current || allSeries.length === 0) return;
    seededRef.current = true;
    const withTrend = allSeries.filter((entry) => entry.points.length >= 2);
    const defaults = (withTrend.length > 0 ? withTrend : allSeries).slice(0, 3);
    setPicked({
      keys: defaults.map((entry) => entry.key),
      slots: Object.fromEntries(defaults.map((entry, index) => [entry.key, index])),
    });
  }, [allSeries]);

  // pointerdown rather than mousedown so a tap outside closes the picker on the
  // phone build too, where emulated mouse events are unreliable.
  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [pickerOpen]);

  function toggleItem(key: string) {
    setPicked((prev) => {
      if (prev.keys.includes(key)) {
        const slots = { ...prev.slots };
        delete slots[key];
        return { keys: prev.keys.filter((existing) => existing !== key), slots };
      }
      if (prev.keys.length >= MAX_SERIES) return prev;
      const used = new Set(Object.values(prev.slots));
      let slot = 0;
      while (used.has(slot)) slot += 1;
      return { keys: [...prev.keys, key], slots: { ...prev.slots, [key]: slot } };
    });
  }

  const chartSeries = useMemo(
    () =>
      picked.keys
        .map((key) => {
          const entry = seriesByKey.get(key);
          if (!entry) return null;
          return {
            key,
            name: entry.name,
            color: SERIES_COLORS[(picked.slots[key] ?? 0) % SERIES_COLORS.length],
            unitLabel: entry.unitLabel,
            points: entry.points,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [picked, seriesByKey]
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allSeries;
    return allSeries.filter((entry) => entry.key.includes(needle));
  }, [allSeries, query]);

  const excludedLines = chartSeries.reduce(
    (sum, entry) => sum + (seriesByKey.get(entry.key)?.excludedCount ?? 0),
    0
  );
  const singlePointItems = chartSeries.filter((entry) => entry.points.length < 2).length;

  if (receipts.length === 0) {
    return (
      <div className="text-center py-20">
        <LineChart size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-semibold text-gray-500">No price history yet</h2>
        <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
          Upload a few receipts and this graph will track what each item costs you over time.
        </p>
      </div>
    );
  }

  if (allSeries.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-500">Nothing to graph yet</h2>
        <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
          Your receipts don&apos;t have priced items with dates yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Controls: what to plot, then how to read it */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="inline-flex items-center gap-2 h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {picked.keys.length === 0
              ? "Choose items"
              : `${picked.keys.length} item${picked.keys.length === 1 ? "" : "s"}`}
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {pickerOpen && (
            <div className="absolute left-0 top-11 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white shadow-xl">
              <label className="relative block border-b border-gray-100 p-2">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  // Focus the search on a desktop pointer only — on a phone it
                  // would throw up the keyboard over the item list.
                  autoFocus={
                    typeof window !== "undefined" &&
                    Boolean(window.matchMedia?.("(pointer: fine)").matches)
                  }
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search items"
                  className="h-8 w-full rounded-md border border-gray-200 pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </label>
              <ul className="max-h-72 overflow-y-auto py-1">
                {visibleItems.map((entry) => {
                  const isSelected = picked.keys.includes(entry.key);
                  const atLimit = !isSelected && picked.keys.length >= MAX_SERIES;
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        disabled={atLimit}
                        onClick={() => toggleItem(entry.key)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          atLimit ? "cursor-not-allowed opacity-40" : "hover:bg-gray-50"
                        }`}
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            isSelected ? "border-brand-600 bg-brand-600" : "border-gray-300"
                          }`}
                        >
                          {isSelected && <Check size={12} className="text-white" />}
                        </span>
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: isSelected
                              ? SERIES_COLORS[(picked.slots[entry.key] ?? 0) % SERIES_COLORS.length]
                              : "transparent",
                          }}
                        />
                        <span className="flex-1 truncate text-gray-700">{entry.name}</span>
                        <span className="shrink-0 text-xs text-gray-400">
                          {entry.purchaseCount}×
                        </span>
                      </button>
                    </li>
                  );
                })}
                {visibleItems.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-gray-400">No matching items</li>
                )}
              </ul>
              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
                <span>Most bought first · max {MAX_SERIES}</span>
                <button
                  type="button"
                  onClick={() => setPicked({ keys: [], slots: {} })}
                  className="font-medium text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {MODES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                mode === value ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {chartSeries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">Pick one or more items to graph.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <PriceTrendChart series={chartSeries} mode={mode} />
          </div>

          {/* Legend — the identity channel, and where each item's unit basis is stated */}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {chartSeries.map((entry) => {
              const points = entry.points;
              const first = points[0];
              const last = points[points.length - 1];
              const change = toModeValue(last.pricePerUnit, first.pricePerUnit, "percent");
              return (
                <li
                  key={entry.key}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2"
                >
                  <span
                    className="h-0.5 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{entry.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatUsd(last.pricePerUnit)}/{entry.unitLabel}
                      {points.length > 1 && (
                        <>
                          {" · "}
                          <span
                            className={
                              change > 0 ? "text-red-600" : change < 0 ? "text-brand-700" : ""
                            }
                          >
                            {formatModeValue(change, "percent")}
                          </span>{" "}
                          since {formatPointDate(first.date, true)}
                        </>
                      )}
                      {points.length === 1 && " · one purchase"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleItem(entry.key)}
                    className="shrink-0 rounded p-1 text-gray-300 hover:text-gray-600"
                    title={`Remove ${entry.name}`}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-xs text-gray-400">
            Prices are normalized per unit of each item ($/lb, $/qt, or $/each as shown above);
            change is measured from that item&apos;s first purchase.
            {singlePointItems > 0 &&
              ` ${singlePointItems} selected item${
                singlePointItems === 1 ? " has" : "s have"
              } only one purchase, so there is no trend to draw yet.`}
            {excludedLines > 0 &&
              ` ${excludedLines} purchase${
                excludedLines === 1 ? " was" : "s were"
              } left out for being measured a different way (e.g. by count instead of by weight).`}
          </p>

          <details
            open={showTable}
            onToggle={(event) => setShowTable((event.target as HTMLDetailsElement).open)}
            className="mt-4"
          >
            <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
              {showTable ? "Hide" : "Show"} the numbers
            </summary>
            <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium text-right">Price/unit</th>
                    <th className="px-3 py-2 font-medium text-right">
                      {mode === "percent" ? "% change" : mode === "dollar" ? "$ change" : "Spent"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chartSeries.flatMap((entry) =>
                    entry.points.map((point) => (
                      <tr key={`${entry.key}-${point.date}`} className="border-t border-gray-100">
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-0.5 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="truncate text-gray-700">{entry.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">
                          {formatPointDate(point.date, true)}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right text-gray-900"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {formatUsd(point.pricePerUnit)}/{entry.unitLabel}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right text-gray-500"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {mode === "price"
                            ? formatUsd(point.spend)
                            : formatModeValue(
                                toModeValue(point.pricePerUnit, entry.points[0].pricePerUnit, mode),
                                mode
                              )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
