import {
  IngredientPriceEstimate,
  RecipePriceEstimate,
  RecipePricingRequest,
} from "@/lib/recipePricing";
import { Ingredient, ReceiptItem } from "@/lib/types";
import { normalizeExactUnit } from "@/lib/unitConversion";
import { estimateProduceIngredientPrice } from "@/lib/usdaProducePricing";
import {
  buildEstimateFromClaudePricing,
  resolveClaudePricing,
} from "@/lib/claudeGroceryPricing";
import { priceIngredientFromReceiptItem } from "@/lib/receiptPricing";

const VOLUME_UNITS = new Set([
  "cup",
  "tbsp",
  "tsp",
  "fl oz",
  "ml",
  "l",
  "pint",
  "quart",
  "gallon",
]);

const MASS_UNITS = new Set(["g", "kg", "oz", "lb"]);

type StandardPricingUnit = "count" | "g" | "ml";

export class PricingRouteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PricingRouteError";
  }
}

const COUNT_UNITS = new Set([
  "",
  "bunch",
  "bunches",
  "can",
  "cans",
  "clove",
  "cloves",
  "head",
  "heads",
  "jar",
  "jars",
  "package",
  "packages",
  "packet",
  "packets",
  "piece",
  "pieces",
  "slice",
  "slices",
  "sprig",
  "sprigs",
  "stalk",
  "stalks",
  "stick",
  "sticks",
  "whole",
]);

const WEIGHT_PREFERRED_NAME_PATTERNS = [
  /\b(chili crisp|chilli crisp|gochujang|miso|mole paste|paste|pesto|purée|puree|sambal|spread|tahini|tomato paste)\b/i,
  /\b(peanut butter|almond butter|sunflower butter|cream cheese|jam|jelly|hummus|nut butter)\b/i,
];

const VOLUME_PREFERRED_NAME_PATTERNS = [
  /\b(broth|stock|juice|milk|oil|soy sauce|tamari|vinegar|water|wine)\b/i,
  /\b(extract|syrup|hot sauce|fish sauce|worcestershire|dressing)\b/i,
];

interface SimpleSearchPlan {
  canonicalName: string;
  searchQueries: string[];
  pricingUnit: StandardPricingUnit;
  pricingQuantity: number | null;
}

function isIngredient(value: unknown): value is Ingredient {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.quantity === "string" &&
    typeof candidate.unit === "string" &&
    typeof candidate.section === "string"
  );
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeUnitKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildSearchQuery(name: string): string {
  return normalizeText(
    name
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(for serving|for garnish|to taste|as needed|divided|plus more[\w\s-]*)\b/gi, " ")
      .replace(/\b(freshly|finely|thinly|roughly|coarsely)\b/gi, " ")
      .replace(/[,+/]/g, " ")
      .replace(/\s+/g, " ")
  );
}

function inferPricingUnit(ingredient: Ingredient): StandardPricingUnit {
  const normalizedName = normalizeText(ingredient.name);
  const normalizedUnit = normalizeUnitKey(ingredient.unit);

  if (COUNT_UNITS.has(normalizedUnit)) {
    return "count";
  }

  if (ingredient.section === "Beverages") {
    return "ml";
  }

  if (WEIGHT_PREFERRED_NAME_PATTERNS.some((p) => p.test(normalizedName))) {
    return "g";
  }

  if (VOLUME_PREFERRED_NAME_PATTERNS.some((p) => p.test(normalizedName))) {
    return "ml";
  }

  const exactUnit = normalizeExactUnit(ingredient.unit);
  if (exactUnit && VOLUME_UNITS.has(exactUnit)) return "ml";
  if (exactUnit && MASS_UNITS.has(exactUnit)) return "g";

  return "g";
}

function buildSearchPlan(ingredient: Ingredient): SimpleSearchPlan {
  const query = buildSearchQuery(ingredient.name) || ingredient.name.toLowerCase();
  return {
    canonicalName: query,
    searchQueries: [query],
    pricingUnit: inferPricingUnit(ingredient),
    pricingQuantity: null,
  };
}

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, run);
  await Promise.all(lanes);
  return results;
}

function buildUnavailableEstimate(ingredient: Ingredient): IngredientPriceEstimate {
  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice: null,
    adjustedPriceText: null,
    packagePrice: null,
    packagePriceText: null,
    confidence: null,
    explanation: "No pricing source returned a result for this ingredient.",
    unavailableReason: "No pricing source returned a result for this ingredient.",
    source: "estimate",
  };
}

export async function estimateRecipeWithWalmartSearch(
  input: unknown,
  options: { receiptLibrary?: ReceiptItem[] } = {}
): Promise<RecipePriceEstimate> {
  const body = (input ?? {}) as RecipePricingRequest;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(isIngredient) : [];
  const receiptLibrary = options.receiptLibrary ?? [];

  if (ingredients.length === 0) {
    return {
      provider: "hybrid",
      estimatedAt: new Date().toISOString(),
      currencyCode: "USD",
      totalAdjustedPrice: 0,
      totalAdjustedPriceText: formatUsd(0),
      resolvedIngredientCount: 0,
      unresolvedIngredientCount: 0,
      ingredients: [],
    };
  }

  // Resolve Claude matches (ingredient -> receipt item) + fallback estimates in one call.
  const { entries, noQuantityEstimates } = await resolveClaudePricing(
    ingredients,
    receiptLibrary
  );
  const receiptById = new Map<string, ReceiptItem>(
    receiptLibrary.map((item) => [item.id, item])
  );

  const resolvedById = new Map<string, IngredientPriceEstimate>();

  // Tier 1 — RECEIPTS: deterministically price each ingredient matched to a
  // receipt line using its price-per-quantity, scaled to the recipe amount.
  await mapWithConcurrency(ingredients, 6, async (ingredient) => {
    if (noQuantityEstimates.has(ingredient.id)) return;
    const entry = entries.get(ingredient.id);
    const receiptItem = entry?.matchedReceiptItemId
      ? receiptById.get(entry.matchedReceiptItemId)
      : undefined;
    if (!receiptItem) return;

    try {
      const estimate = await priceIngredientFromReceiptItem(ingredient, receiptItem);
      if (estimate && estimate.adjustedPrice !== null) {
        resolvedById.set(ingredient.id, estimate);
      }
    } catch (error) {
      console.error("Receipt pricing failed for ingredient:", ingredient.name, error);
    }
  });

  // Tier 2 — USDA produce averages, only for produce ingredients with no receipt price.
  await mapWithConcurrency(ingredients, 4, async (ingredient) => {
    if (resolvedById.has(ingredient.id) || noQuantityEstimates.has(ingredient.id)) return;
    if (ingredient.section !== "Produce") return;
    try {
      const estimate = await estimateProduceIngredientPrice(
        ingredient,
        buildSearchPlan(ingredient)
      );
      if (estimate && estimate.adjustedPrice !== null) {
        resolvedById.set(ingredient.id, estimate);
      }
    } catch (error) {
      console.error("USDA produce pricing failed for ingredient:", ingredient.name, error);
    }
  });

  // Tier 3 — Claude estimate fallback for anything still unpriced.
  for (const ingredient of ingredients) {
    if (resolvedById.has(ingredient.id)) continue;

    const noQuantity = noQuantityEstimates.get(ingredient.id);
    if (noQuantity) {
      resolvedById.set(ingredient.id, noQuantity);
      continue;
    }

    const entry = entries.get(ingredient.id);
    if (entry) {
      resolvedById.set(ingredient.id, buildEstimateFromClaudePricing(ingredient, entry));
    }
  }

  const estimates: IngredientPriceEstimate[] = ingredients.map(
    (ingredient) => resolvedById.get(ingredient.id) ?? buildUnavailableEstimate(ingredient)
  );

  const totalAdjustedPrice = roundToCents(
    estimates.reduce((sum, estimate) => sum + (estimate.adjustedPrice ?? 0), 0)
  );
  const resolvedIngredientCount = estimates.filter((e) => e.adjustedPrice !== null).length;

  return {
    provider: "hybrid",
    estimatedAt: new Date().toISOString(),
    currencyCode: "USD",
    totalAdjustedPrice,
    totalAdjustedPriceText: formatUsd(totalAdjustedPrice),
    resolvedIngredientCount,
    unresolvedIngredientCount: estimates.length - resolvedIngredientCount,
    ingredients: estimates,
  };
}

export const estimateRecipeWithOpenFoodFacts = estimateRecipeWithWalmartSearch;
