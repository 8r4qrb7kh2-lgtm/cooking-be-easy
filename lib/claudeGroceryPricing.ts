import Anthropic from "@anthropic-ai/sdk";
import { Ingredient, ReceiptItem } from "@/lib/types";
import { IngredientPriceEstimate } from "@/lib/recipePricing";

const CLAUDE_PRICING_MODEL = "claude-sonnet-4-5-20250929";
const CLAUDE_PRICING_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const anthropic = process.env.ANTHROPIC_API_KEY?.trim() ? new Anthropic() : null;

interface ClaudePriceEntry {
  ingredientId: string;
  matchTitle: string;
  packageSizeText: string;
  packagePrice: number | null;
  adjustedPrice: number | null;
  confidence: number | null;
  explanation: string;
  unavailableReason: string | null;
  source: "receipt" | "estimate";
  matchedReceiptItemId: string | null;
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<Map<string, ClaudePriceEntry>>;
}

const claudePricingCache = new Map<string, CacheEntry>();

function getCacheKey(ingredients: Ingredient[], receiptLibrary: ReceiptItem[]): string {
  const ingredientKey = ingredients
    .map((i) =>
      [i.id, i.name.toLowerCase(), i.quantity, i.unit, i.section].join(":")
    )
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

function hasUsefulQuantity(ingredient: Ingredient): boolean {
  const quantity = ingredient.quantity?.trim().toLowerCase() ?? "";
  if (!quantity) return false;
  if (quantity === "to taste") return false;
  if (quantity === "as needed") return false;
  if (quantity === "optional") return false;
  if (quantity === "pinch" && !ingredient.unit) return true;
  return /[0-9]/.test(quantity) || /pinch|dash|splash|handful/i.test(quantity);
}

function parseClaudeResponse(text: string): ClaudePriceEntry[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse Claude pricing response");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    estimates?: Array<{
      ingredientId?: unknown;
      matchTitle?: unknown;
      packageSizeText?: unknown;
      packagePrice?: unknown;
      adjustedPrice?: unknown;
      confidence?: unknown;
      explanation?: unknown;
      unavailableReason?: unknown;
      source?: unknown;
      matchedReceiptItemId?: unknown;
    }>;
  };

  if (!Array.isArray(parsed.estimates)) {
    return [];
  }

  const results: ClaudePriceEntry[] = [];
  for (const entry of parsed.estimates) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.ingredientId !== "string" || !entry.ingredientId) continue;

    const packagePrice = sanitizeNumber(entry.packagePrice);
    const adjustedPrice = sanitizeNumber(entry.adjustedPrice);
    const confidenceRaw = sanitizeNumber(entry.confidence);
    const unavailableReason =
      typeof entry.unavailableReason === "string" && entry.unavailableReason.trim()
        ? entry.unavailableReason.trim()
        : null;

    const sourceRaw = (entry as { source?: unknown }).source;
    const source: "receipt" | "estimate" = sourceRaw === "receipt" ? "receipt" : "estimate";
    const matchedIdRaw = (entry as { matchedReceiptItemId?: unknown }).matchedReceiptItemId;
    const matchedReceiptItemId =
      typeof matchedIdRaw === "string" && matchedIdRaw.trim() ? matchedIdRaw.trim() : null;

    results.push({
      ingredientId: entry.ingredientId,
      matchTitle:
        typeof entry.matchTitle === "string" && entry.matchTitle.trim()
          ? entry.matchTitle.trim()
          : "Grocery estimate",
      packageSizeText:
        typeof entry.packageSizeText === "string" && entry.packageSizeText.trim()
          ? entry.packageSizeText.trim()
          : "typical grocery package",
      packagePrice,
      adjustedPrice,
      confidence: confidenceRaw !== null ? clampConfidence(confidenceRaw) : null,
      explanation:
        typeof entry.explanation === "string" && entry.explanation.trim()
          ? entry.explanation.trim()
          : "Claude estimate based on typical US grocery prices.",
      unavailableReason,
      source,
      matchedReceiptItemId,
    });
  }

  return results;
}

async function callClaudeForPricing(
  ingredients: Ingredient[],
  receiptLibrary: ReceiptItem[]
): Promise<Map<string, ClaudePriceEntry>> {
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const hasReceipts = receiptLibrary.length > 0;

  const systemPrompt = `You are a grocery pricing expert with deep knowledge of typical US national supermarket averages across Walmart, Kroger, Safeway, Publix, and regional chains as of 2025.

Your job: estimate the cost of specific recipe ingredient quantities.

PRICING PRIORITY — USE THE USER'S RECEIPT LIBRARY WHEN APPLICABLE:
- If the user has provided receipt items (the "receiptLibrary" below), match each recipe ingredient against the most recent applicable receipt item.
- A receipt-library match is applicable when the receipt item is the SAME GROCERY PRODUCT the recipe ingredient calls for (same food, compatible form). Brand differences are OK.
- When you use a receipt match: set source="receipt", set matchedReceiptItemId to that item's id, use its totalPrice as the packagePrice basis, and scale adjustedPrice by (recipe quantity) / (receipt item quantity or its package size).
- Otherwise set source="estimate" and fall back to typical US grocery averages.

For EACH ingredient, output:
- source: "receipt" or "estimate"
- matchedReceiptItemId: the receipt item id when source="receipt", else null
- packagePrice: cost of one typical grocery package (from receipt or typical)
- adjustedPrice: cost of ONLY the recipe's quantity (e.g. recipe wants 2 tbsp of a 15 oz soy-sauce bottle the user paid $3.25 for → adjustedPrice ≈ 0.13)
- packageSizeText: short description of the package priced (e.g., "1 bunch", "16 oz box", or the receipt's packageSizeText)
- matchTitle: generic grocery product name (lowercase, no brand)
- confidence: 0.0–1.0
- explanation: one short sentence about the price source/logic. For receipt matches, reference the store and purchase date (e.g. "based on Whole Foods Market receipt 2026-04-23, $3.25 for 15 fl oz tamari, used 2 tbsp")
- unavailableReason: null if you returned a price

Rules for adjustedPrice:
- A pinch of salt, 1 bay leaf, or 1/4 tsp of a common spice is pennies — use 0.02-0.15
- Small amounts of pantry staples (flour, sugar, oil): proportion of package price
- Fresh produce by count or bunch: scale appropriately (2 scallions out of a bunch of 8 from a $1.99 bunch ≈ $0.50)
- Meat/seafood: price for the exact weight needed
- Always return a realistic USD number; round to 2 decimals
- Return null ONLY if quantity is truly unknowable (e.g., "to taste" with no practical equivalent)

Output ONLY valid JSON, no commentary, no markdown fences:
{
  "estimates": [
    {
      "ingredientId": "exact id from input",
      "source": "receipt" | "estimate",
      "matchedReceiptItemId": "receipt-item-uuid or null",
      "matchTitle": "generic product name",
      "packageSizeText": "15 fl oz bottle",
      "packagePrice": 3.25,
      "adjustedPrice": 0.13,
      "confidence": 0.9,
      "explanation": "based on Whole Foods receipt 2026-04-23, $3.25 for 15 fl oz tamari, used 2 tbsp",
      "unavailableReason": null
    }
  ]
}`;

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
    ? `Price every ingredient below. Prefer matches from the user's receipt library when applicable.\n\nreceiptLibrary:\n${JSON.stringify(receiptPayload, null, 2)}\n\ningredients:\n${JSON.stringify(userPayload, null, 2)}\n\nReturn one estimate per ingredient, matching ingredientId exactly.`
    : `Price every ingredient below. The user has no receipt library yet, so use typical US grocery averages.\n\ningredients:\n${JSON.stringify(userPayload, null, 2)}\n\nReturn one estimate per ingredient (source="estimate", matchedReceiptItemId=null), matching ingredientId exactly.`;

  const message = await anthropic.messages.create({
    model: CLAUDE_PRICING_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const parsed = parseClaudeResponse(text);
  return new Map(parsed.map((entry) => [entry.ingredientId, entry]));
}

function buildEstimateFromClaude(
  ingredient: Ingredient,
  entry: ClaudePriceEntry,
  receiptById: Map<string, ReceiptItem>
): IngredientPriceEstimate {
  const adjustedPrice = entry.adjustedPrice !== null ? roundToCents(entry.adjustedPrice) : null;
  const packagePrice = entry.packagePrice !== null ? roundToCents(entry.packagePrice) : null;
  const matchedReceipt = entry.matchedReceiptItemId
    ? receiptById.get(entry.matchedReceiptItemId) ?? null
    : null;
  const isReceiptMatch = entry.source === "receipt" && matchedReceipt !== null;

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
    matchStore: isReceiptMatch ? matchedReceipt?.storeName : undefined,
    matchUrl: undefined,
    confidence: entry.confidence ?? (isReceiptMatch ? 0.9 : 0.7),
    explanation: entry.explanation,
    unavailableReason: adjustedPrice === null ? entry.unavailableReason ?? null : null,
  };
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
  };
}

function buildFailureEstimate(
  ingredient: Ingredient,
  reason: string
): IngredientPriceEstimate {
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
    explanation: "Claude grocery pricing was unavailable for this ingredient.",
    unavailableReason: reason,
  };
}

export async function estimateIngredientsWithClaude(
  ingredients: Ingredient[],
  receiptLibrary: ReceiptItem[] = []
): Promise<Map<string, IngredientPriceEstimate>> {
  const results = new Map<string, IngredientPriceEstimate>();

  const pricable: Ingredient[] = [];
  for (const ingredient of ingredients) {
    if (hasUsefulQuantity(ingredient)) {
      pricable.push(ingredient);
    } else {
      results.set(ingredient.id, buildNoQuantityEstimate(ingredient));
    }
  }

  if (pricable.length === 0) {
    return results;
  }

  if (!anthropic) {
    for (const ingredient of pricable) {
      results.set(
        ingredient.id,
        buildFailureEstimate(
          ingredient,
          "Claude grocery pricing is not configured (missing ANTHROPIC_API_KEY)."
        )
      );
    }
    return results;
  }

  const receiptById = new Map<string, ReceiptItem>(
    receiptLibrary.map((item) => [item.id, item])
  );

  try {
    const cacheKey = getCacheKey(pricable, receiptLibrary);
    const priceMap = await getCached(claudePricingCache, cacheKey, () =>
      callClaudeForPricing(pricable, receiptLibrary)
    );

    for (const ingredient of pricable) {
      const entry = priceMap.get(ingredient.id);
      if (!entry) {
        results.set(
          ingredient.id,
          buildFailureEstimate(
            ingredient,
            "Claude did not return a price estimate for this ingredient."
          )
        );
        continue;
      }
      results.set(ingredient.id, buildEstimateFromClaude(ingredient, entry, receiptById));
    }
  } catch (error) {
    console.error("Claude grocery pricing failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    for (const ingredient of pricable) {
      results.set(
        ingredient.id,
        buildFailureEstimate(
          ingredient,
          `Claude grocery pricing request failed: ${message}`
        )
      );
    }
  }

  return results;
}

export function isClaudePricingAvailable(): boolean {
  return Boolean(anthropic);
}
