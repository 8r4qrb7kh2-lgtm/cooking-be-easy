import { Receipt, ReceiptItem } from "@/lib/types";
import { EXACT_UNIT_FACTORS, normalizeExactUnit, parsePackageSize } from "@/lib/unitTables";

/**
 * Turns the receipt price library into per-item price-over-time series.
 *
 * Receipt lines are measured every which way — "3.27 lb" of chicken, "2 count"
 * of 13.5 oz cans, a bare "1" for a bunch of scallions — so a raw line total
 * says nothing about whether an item got more expensive. Every line is first
 * normalized to a price per canonical unit ($/lb, $/qt, or $/each) and only
 * lines sharing an item's dominant basis are plotted together.
 *
 * Client-safe: imports only the SDK-free unit tables.
 */

export type PriceBasis = "weight" | "volume" | "count";

export type PriceMode = "price" | "dollar" | "percent";

const GRAMS_PER_POUND = 453.59237;
const MILLILITERS_PER_QUART = 946.352946;

export const BASIS_UNIT_LABEL: Record<PriceBasis, string> = {
  weight: "lb",
  volume: "qt",
  count: "each",
};

/** Prefer the more precise basis when an item has an equal number of lines on two of them. */
const BASIS_PRIORITY: Record<PriceBasis, number> = { weight: 3, volume: 2, count: 1 };

export interface PricePoint {
  /** Local midnight of the purchase date, in ms. */
  date: number;
  /** Price per canonical unit ($/lb, $/qt, $/each). */
  pricePerUnit: number;
  /** Dollars spent on this item that day. */
  spend: number;
  /** Amount bought that day, in canonical units. */
  amount: number;
  /** How many receipt lines were pooled into this point. */
  lines: number;
  stores: string[];
}

export interface ItemPriceSeries {
  key: string;
  name: string;
  basis: PriceBasis;
  /** "lb" | "qt" | "each" */
  unitLabel: string;
  /** Times this item was bought, counting every line on any basis — the dropdown's sort key. */
  purchaseCount: number;
  /** Lines dropped because they were measured on a different basis than the item's dominant one. */
  excludedCount: number;
  points: PricePoint[];
}

interface NormalizedAmount {
  basis: PriceBasis;
  /** Amount in canonical units (lb, qt, or each). */
  amount: number;
}

/**
 * Express a receipt line as an amount in canonical units, so its total price
 * becomes a comparable per-unit price. Weighed and volume-measured lines convert
 * exactly; counted lines convert when the package size names a measurable size
 * ("2" x "13.5 oz can"), and otherwise stay a plain count.
 */
export function normalizeReceiptItemAmount(item: ReceiptItem): NormalizedAmount | null {
  const quantity =
    typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
      ? item.quantity
      : null;

  const exactUnit = item.unit ? normalizeExactUnit(item.unit) : null;
  if (exactUnit && quantity) {
    return toCanonical(exactUnit, quantity);
  }

  // Count-like line. A measurable package size upgrades it to weight/volume.
  const count = quantity ?? 1;
  const packageSize = parsePackageSize(item.packageSizeText);
  if (packageSize) {
    return toCanonical(packageSize.unit, count * packageSize.value);
  }

  return { basis: "count", amount: count };
}

function toCanonical(
  unit: keyof typeof EXACT_UNIT_FACTORS,
  quantity: number
): NormalizedAmount | null {
  const { category, factor } = EXACT_UNIT_FACTORS[unit];
  const amount =
    category === "mass"
      ? (quantity * factor) / GRAMS_PER_POUND
      : (quantity * factor) / MILLILITERS_PER_QUART;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { basis: category === "mass" ? "weight" : "volume", amount };
}

/** Local midnight for a receipt date, so points land on calendar days regardless of timezone. */
function parseLocalDay(raw: string | undefined): number | null {
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Receipt item names are stored lowercase, but they still arrive with stray spacing/punctuation. */
function itemKey(item: ReceiptItem): string {
  const name = (item.normalizedName || item.rawLabel || "").toLowerCase();
  return name
    .replace(/[^a-z0-9%&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(key: string): string {
  return key.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

interface Observation {
  date: number;
  basis: PriceBasis;
  amount: number;
  spend: number;
  store?: string;
}

/**
 * Build one series per grocery item, newest-purchase math included:
 * lines bought on the same day are pooled (total spend / total amount) so each
 * day contributes a single, spend-weighted price.
 */
export function buildItemPriceSeries(receipts: Receipt[]): ItemPriceSeries[] {
  const observationsByKey = new Map<string, Observation[]>();

  for (const receipt of receipts) {
    for (const item of receipt.items) {
      const key = itemKey(item);
      if (!key) continue;
      if (!Number.isFinite(item.totalPrice) || item.totalPrice <= 0) continue;

      const date = parseLocalDay(item.purchasedAt ?? receipt.purchaseDate ?? receipt.createdAt);
      if (date === null) continue;

      const normalized = normalizeReceiptItemAmount(item);
      if (!normalized) continue;

      const list = observationsByKey.get(key) ?? [];
      list.push({
        date,
        basis: normalized.basis,
        amount: normalized.amount,
        spend: item.totalPrice,
        store: item.storeName ?? receipt.storeName,
      });
      observationsByKey.set(key, list);
    }
  }

  const series: ItemPriceSeries[] = [];

  for (const [key, observations] of observationsByKey) {
    const basis = dominantBasis(observations);
    const onBasis = observations.filter((observation) => observation.basis === basis);
    if (onBasis.length === 0) continue;

    const byDate = new Map<number, Observation[]>();
    for (const observation of onBasis) {
      const list = byDate.get(observation.date) ?? [];
      list.push(observation);
      byDate.set(observation.date, list);
    }

    const points: PricePoint[] = [];
    for (const [date, sameDay] of byDate) {
      const spend = sameDay.reduce((sum, o) => sum + o.spend, 0);
      const amount = sameDay.reduce((sum, o) => sum + o.amount, 0);
      if (amount <= 0) continue;
      points.push({
        date,
        pricePerUnit: spend / amount,
        spend,
        amount,
        lines: sameDay.length,
        stores: [...new Set(sameDay.map((o) => o.store).filter((s): s is string => Boolean(s)))],
      });
    }
    if (points.length === 0) continue;
    points.sort((a, b) => a.date - b.date);

    series.push({
      key,
      name: displayName(key),
      basis,
      unitLabel: BASIS_UNIT_LABEL[basis],
      purchaseCount: observations.length,
      excludedCount: observations.length - onBasis.length,
      points,
    });
  }

  // Most commonly bought first — the order the item picker shows them in.
  series.sort(
    (a, b) =>
      b.purchaseCount - a.purchaseCount ||
      b.points.length - a.points.length ||
      a.name.localeCompare(b.name)
  );

  return series;
}

function dominantBasis(observations: Observation[]): PriceBasis {
  const counts = new Map<PriceBasis, number>();
  for (const observation of observations) {
    counts.set(observation.basis, (counts.get(observation.basis) ?? 0) + 1);
  }
  let best: PriceBasis = "count";
  let bestCount = -1;
  for (const [basis, count] of counts) {
    if (count > bestCount || (count === bestCount && BASIS_PRIORITY[basis] > BASIS_PRIORITY[best])) {
      best = basis;
      bestCount = count;
    }
  }
  return best;
}

/** The value plotted for a point: the price itself, or its change from the item's first purchase. */
export function toModeValue(pricePerUnit: number, baseline: number, mode: PriceMode): number {
  if (mode === "price") return pricePerUnit;
  if (mode === "dollar") return pricePerUnit - baseline;
  if (baseline <= 0) return 0;
  return ((pricePerUnit - baseline) / baseline) * 100;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatModeValue(value: number, mode: PriceMode): string {
  if (mode === "percent") {
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(rounded)}%`;
  }
  if (mode === "dollar") {
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${usdPrecise.format(Math.abs(value))}`;
  }
  return usdPrecise.format(value);
}

/** Axis-tick formatting: same units, but terser than the tooltip's. */
export function formatAxisValue(value: number, mode: PriceMode): string {
  if (mode === "percent") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1 ? 2 : abs < 10 ? 2 : 0;
  const text = `$${abs.toFixed(digits)}`;
  if (mode === "dollar" && value !== 0) return `${value > 0 ? "+" : "−"}${text}`;
  return text;
}

export function formatPointDate(date: number, withYear = false): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
}
