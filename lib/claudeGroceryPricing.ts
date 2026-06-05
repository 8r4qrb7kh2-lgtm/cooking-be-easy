import Anthropic from "@anthropic-ai/sdk";
import { Ingredient, ReceiptItem } from "@/lib/types";
import { IngredientPriceEstimate } from "@/lib/recipePricing";

const CLAUDE_PRICING_MODEL = "claude-sonnet-4-5-20250929";
const CLAUDE_PRICING_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const anthropic = process.env.ANTHROPIC_API_KEY?.trim() ? new Anthropic() : null;

/**
 * Claude's contribution to pricing is now two-fold:
 *   1. MATCH each recipe ingredient to the most applicable receipt line (by id),
 *      so the app can deterministically compute the price from that receipt.
 *   2. ESTIMATE a typical US grocery cost as a fallback used only when there is
 *      no receipt match (or the receipt math cannot be reconciled).
 */
export interface ClaudePricingEntry {
  ingredientId: string;
  matchedReceiptItemId: string | null;
  matchTitle: string;
  packageSizeText: string;
  estimatePrice: number | null;
  estimatePackagePrice: number | null;
  confidence: number | null;
  explanation: string;
  unavailableReason: string | null;
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<Map<string, ClaudePricingEntry>>;
}

const claudePricingCache = new Map<string, CacheEntry>();

function getCacheKey(ingredients: Ingredient[], receiptLibrary: ReceiptItem[]): string {
  const ingredientKey = ingredients
    .map((i) => [i.id, i.name.toLowerCase(), i.quantity, i.unit, i.section].join(":"))
    .join("|");
  const libraryKey = receiptLibrary
    .map((r) => [r.id, r.totalPrice, r.purchasedAt ?? ""].join(":"))
    .join("|");
  return `${ingredientKey}##${libraryKey}`;
}

function getCached<T>(
  cache: Map<string, { expiresAt: number; value: Promise<T> }>,
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = loader().catch((error) => {
    cache.delete(key);
    throw error;
  });

  cache.set(key, {
    expiresAt: now + CLAUDE_PRICING_CACHE_TTL_MS,
    value,
  });

  return value;
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

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

// ASCII digits plus unicode vulgar fractions (¼ ½ ¾ ⅓ ⅔ ⅛ … U+00BC–U+00BE,
// U+2150–U+215E) so quantities entered as "½" or "¾" count as real amounts.
const NUMERIC_QUANTITY_PATTERN = /[0-9¼-¾⅐-⅞]/;

function hasUsefulQuantity(ingredient: Ingredient): boolean {
  const quantity = ingredient.quantity?.trim().toLowerCase() ?? "";
  if (!quantity) return false;
  if (quantity === "to taste") return false;
  if (quantity === "as needed") return false;
  if (quantity === "optional") return false;
  if (quantity === "pinch" && !ingredient.unit) return true;
  return NUMERIC_QUANTITY_PATTERN.test(quantity) || /pinch|dash|splash|handful/i.test(quantity);
}

const PRICING_TOOL: Anthropic.Tool = {
  name: "submit_pricing",
  description:
    "Submit, for every ingredient, the matching receipt-item id (if any) and a fallback typical US grocery price estimate.",
  input_schema: {
    type: "object",
    properties: {
      estimates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ingredientId: { type: "string", description: "Exact id from the input." },
            matchedReceiptItemId: {
              type: "string",
              description:
                "Id of the receipt item that is the same grocery product as this ingredient (brand-agnostic, compatible form). Empty string if none applies.",
            },
            matchTitle: {
              type: "string",
              description: "Generic grocery product name, lowercase, no brand.",
            },
            packageSizeText: {
              type: "string",
              description: "Typical package size, e.g. '16 oz box'. Empty if unknown.",
            },
            estimatePrice: {
              type: "number",
              description:
                "Fallback cost in USD of ONLY the recipe's quantity using typical US grocery averages. 0 only if truly unknowable.",
            },
            estimatePackagePrice: {
              type: "number",
              description: "Typical full-package price in USD. 0 if unknown.",
            },
            confidence: { type: "number", description: "0.0 to 1.0" },
            explanation: { type: "string", description: "One short sentence on the estimate basis." },
            unavailableReason: {
              type: "string",
              description: "Empty if you returned a price; else why it is unknowable.",
            },
          },
          required: ["ingredientId", "matchedReceiptItemId", "estimatePrice"],
        },
      },
    },
    required: ["estimates"],
  },
};

function buildSystemPrompt(hasReceipts: boolean): string {
  return `You are a grocery pricing expert with deep knowledge of typical US national supermarket averages across Walmart, Kroger, Safeway, Publix, and regional chains as of 2025.

You have TWO jobs for each recipe ingredient:

1. MATCH TO A RECEIPT (only if a receipt library is provided):
${
  hasReceipts
    ? `- Find the receipt item that is the SAME GROCERY PRODUCT this ingredient calls for (same food, compatible form). Brand differences are OK (tamari ↔ soy sauce, baby bella ↔ mushrooms).
- Set matchedReceiptItemId to that receipt item's exact id. If none of the receipt items is the same product, set it to "" (empty string).
- The app itself computes the actual paid price from the matched receipt's price-per-quantity — you do NOT need to scale receipt prices.`
    : `- No receipt library was provided, so set matchedReceiptItemId to "" for every ingredient.`
}

2. ESTIMATE A FALLBACK PRICE (always):
- estimatePrice = cost in USD of ONLY the recipe's quantity using typical US grocery averages (e.g. recipe wants 2 tbsp of a soy sauce bottle → ~0.13).
- estimatePackagePrice = typical full-package price.
- This estimate is used ONLY when there is no receipt match, so always provide a realistic number anyway.

Rules for estimatePrice:
- A pinch of salt, 1 bay leaf, or 1/4 tsp of a common spice is pennies — use 0.02-0.15.
- Small amounts of pantry staples (flour, sugar, oil): a proportion of the package price.
- Fresh produce by count or bunch: scale appropriately.
- Meat/seafood: price for the exact weight needed.
- Round to 2 decimals. Return 0 only if the quantity is truly unknowable (e.g. "to taste").

Call submit_pricing with one entry per ingredient, matching ingredientId exactly.`;
}

async function callClaudeForPricing(
  ingredients: Ingredient[],
  receiptLibrary: ReceiptItem[]
): Promise<Map<string, ClaudePricingEntry>> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const hasReceipts = receiptLibrary.length > 0;

  const userPayload = ingredients.map((ingredient) => ({
    ingredientId: ingredient.id,
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    section: ingredient.section,
  }));

  const receiptPayload = receiptLibrary.slice(0, 300).map((item) => ({
    id: item.id,
    normalizedName: item.normalizedName,
    brand: item.brand,
    section: item.section,
    quantity: item.quantity,
    unit: item.unit,
    packageSizeText: item.packageSizeText,
    unitPrice: item.unitPrice,
    totalPrice: item.totalPrice,
    purchasedAt: item.purchasedAt,
    storeName: item.storeName,
  }));

  const userContent = hasReceipts
    ? `Match each ingredient to the most applicable receipt item id, and provide a fallback estimate.\n\nreceiptLibrary:\n${JSON.stringify(receiptPayload, null, 2)}\n\ningredients:\n${JSON.stringify(userPayload, null, 2)}\n\nReturn one entry per ingredient, matching ingredientId exactly.`
    : `The user has no receipt library yet. Set matchedReceiptItemId to "" for every ingredient and estimate typical US grocery prices.\n\ningredients:\n${JSON.stringify(userPayload, null, 2)}\n\nReturn one entry per ingredient, matching ingredientId exactly.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_PRICING_MODEL,
    max_tokens: 8192,
    system: buildSystemPrompt(hasReceipts),
    tools: [PRICING_TOOL],
    tool_choice: { type: "tool", name: "submit_pricing" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return pricing tool output");
  }

  const parsed = toolUse.input as {
    estimates?: Array<Record<string, unknown>>;
  };
  const estimates = Array.isArray(parsed.estimates) ? parsed.estimates : [];

  const results = new Map<string, ClaudePricingEntry>();
  for (const entry of estimates) {
    if (!entry || typeof entry !== "object") continue;
    const ingredientId = entry.ingredientId;
    if (typeof ingredientId !== "string" || !ingredientId) continue;

    const matchedIdRaw = entry.matchedReceiptItemId;
    const matchedReceiptItemId =
      typeof matchedIdRaw === "string" && matchedIdRaw.trim() ? matchedIdRaw.trim() : null;
    const confidenceRaw = sanitizeNumber(entry.confidence);
    const unavailableReason =
      typeof entry.unavailableReason === "string" && entry.unavailableReason.trim()
        ? entry.unavailableReason.trim()
        : null;

    results.set(ingredientId, {
      ingredientId,
      matchedReceiptItemId,
      matchTitle:
        typeof entry.matchTitle === "string" && entry.matchTitle.trim()
          ? entry.matchTitle.trim()
          : "grocery estimate",
      packageSizeText:
        typeof entry.packageSizeText === "string" && entry.packageSizeText.trim()
          ? entry.packageSizeText.trim()
          : "typical grocery package",
      estimatePrice: sanitizeNumber(entry.estimatePrice),
      estimatePackagePrice: sanitizeNumber(entry.estimatePackagePrice),
      confidence: confidenceRaw !== null ? clampConfidence(confidenceRaw) : null,
      explanation:
        typeof entry.explanation === "string" && entry.explanation.trim()
          ? entry.explanation.trim()
          : "Estimated from typical US grocery prices.",
      unavailableReason,
    });
  }

  return results;
}

function buildNoQuantityEstimate(ingredient: Ingredient): IngredientPriceEstimate {
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
    explanation: "No measurable quantity provided (e.g. to taste / as needed).",
    unavailableReason:
      "No measurable quantity provided — add a specific amount to get a price estimate.",
    source: "estimate",
  };
}

/** Convert a Claude pricing entry's fallback estimate into a price estimate. */
export function buildEstimateFromClaudePricing(
  ingredient: Ingredient,
  entry: ClaudePricingEntry
): IngredientPriceEstimate {
  const adjustedPrice =
    entry.estimatePrice !== null ? roundToCents(entry.estimatePrice) : null;
  const packagePrice =
    entry.estimatePackagePrice !== null ? roundToCents(entry.estimatePackagePrice) : null;

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice,
    adjustedPriceText: adjustedPrice !== null ? formatUsd(adjustedPrice) : null,
    packagePrice,
    packagePriceText: packagePrice !== null ? formatUsd(packagePrice) : null,
    packageSizeText: entry.packageSizeText,
    matchTitle: entry.matchTitle,
    matchStore: undefined,
    matchUrl: undefined,
    confidence: entry.confidence ?? 0.65,
    explanation: entry.explanation,
    unavailableReason:
      adjustedPrice === null
        ? entry.unavailableReason ?? "No estimate available for this ingredient."
        : null,
    source: "estimate",
  };
}

/**
 * Resolve Claude pricing entries (receipt matches + fallback estimates) for the
 * given ingredients. Items with no measurable quantity are returned directly as
 * unavailable estimates and excluded from the Claude call.
 */
export async function resolveClaudePricing(
  ingredients: Ingredient[],
  receiptLibrary: ReceiptItem[] = []
): Promise<{
  entries: Map<string, ClaudePricingEntry>;
  noQuantityEstimates: Map<string, IngredientPriceEstimate>;
}> {
  const noQuantityEstimates = new Map<string, IngredientPriceEstimate>();
  const pricable: Ingredient[] = [];

  for (const ingredient of ingredients) {
    if (hasUsefulQuantity(ingredient)) {
      pricable.push(ingredient);
    } else {
      noQuantityEstimates.set(ingredient.id, buildNoQuantityEstimate(ingredient));
    }
  }

  if (pricable.length === 0 || !anthropic) {
    return { entries: new Map(), noQuantityEstimates };
  }

  try {
    const cacheKey = getCacheKey(pricable, receiptLibrary);
    const entries = await getCached(claudePricingCache, cacheKey, () =>
      callClaudeForPricing(pricable, receiptLibrary)
    );
    return { entries, noQuantityEstimates };
  } catch (error) {
    console.error("Claude grocery pricing failed:", error);
    return { entries: new Map(), noQuantityEstimates };
  }
}

export function isClaudePricingAvailable(): boolean {
  return Boolean(anthropic);
}
