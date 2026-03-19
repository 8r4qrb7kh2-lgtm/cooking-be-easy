import {
  IngredientPriceEstimate,
  RecipePriceEstimate,
  RecipePricingLocation,
  RecipePricingRequest,
} from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";

const MEALME_API_BASE_URL = "https://api.mealme.ai";
const MEALME_SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const MEALME_RESULT_LIMIT = 8;

const SEARCH_CLEANUP_PATTERNS = [
  /\([^)]*\)/g,
  /\bfor serving\b/gi,
  /\bdivided\b/gi,
  /\bto taste\b/gi,
  /\bplus more\b[\w\s-]*/gi,
  /\bas needed\b/gi,
  /[,+/]/g,
] as const;

const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "fresh",
  "large",
  "medium",
  "of",
  "optional",
  "small",
  "the",
  "with",
]);

const COUNT_UNITS = new Set([
  "",
  "bag",
  "bags",
  "bottle",
  "bottles",
  "bunch",
  "bunches",
  "bulb",
  "bulbs",
  "can",
  "cans",
  "clove",
  "cloves",
  "container",
  "containers",
  "count",
  "counts",
  "ct",
  "cube",
  "cubes",
  "ea",
  "each",
  "egg",
  "eggs",
  "head",
  "heads",
  "item",
  "items",
  "jar",
  "jars",
  "link",
  "links",
  "loaf",
  "loaves",
  "package",
  "packages",
  "pack",
  "packs",
  "piece",
  "pieces",
  "pkg",
  "sheet",
  "sheets",
  "sprig",
  "sprigs",
  "stalk",
  "stalks",
  "stick",
  "sticks",
]);

const VOLUME_ML_FACTORS: Record<string, number> = {
  "cup": 236.588,
  "cups": 236.588,
  "fl oz": 29.5735,
  "fluid ounce": 29.5735,
  "fluid ounces": 29.5735,
  "floz": 29.5735,
  "gallon": 3785.41,
  "gallons": 3785.41,
  "gal": 3785.41,
  "l": 1000,
  "liter": 1000,
  "liters": 1000,
  "litre": 1000,
  "litres": 1000,
  "ml": 1,
  "milliliter": 1,
  "milliliters": 1,
  "millilitre": 1,
  "millilitres": 1,
  "pint": 473.176,
  "pints": 473.176,
  "pt": 473.176,
  "quart": 946.353,
  "quarts": 946.353,
  "qt": 946.353,
  "tablespoon": 14.7868,
  "tablespoons": 14.7868,
  "tbsp": 14.7868,
  "tbsps": 14.7868,
  "teaspoon": 4.92892,
  "teaspoons": 4.92892,
  "tsp": 4.92892,
  "tsps": 4.92892,
};

const WEIGHT_GRAM_FACTORS: Record<string, number> = {
  "g": 1,
  "gram": 1,
  "grams": 1,
  "kg": 1000,
  "kilogram": 1000,
  "kilograms": 1000,
  "lb": 453.592,
  "lbs": 453.592,
  "pound": 453.592,
  "pounds": 453.592,
};

const AMBIGUOUS_OUNCE_UNITS = new Set(["oz", "ounce", "ounces"]);

const UNICODE_FRACTIONS: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅐": "1/7",
  "⅑": "1/9",
  "⅒": "1/10",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

const searchCache = new Map<
  string,
  { expiresAt: number; value: Promise<MealMeProduct[]> }
>();

type MeasurementDimension = "count" | "volume" | "weight";

interface Measurement {
  amount: number;
  baseAmount: number;
  dimension: MeasurementDimension;
}

interface MealMeProduct {
  productId?: string;
  itemName: string;
  description?: string;
  category?: string;
  formattedPrice?: string;
  packageSizeText?: string;
  priceCents: number;
  storeName?: string;
  storeType?: string;
  unitOfMeasurement?: string;
  unitSize?: number;
}

interface MealMeSearchResponse {
  products?: unknown;
  error?: unknown;
}

export class PricingRouteError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PricingRouteError";
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = cleanText(value);
  return normalized || undefined;
}

function sanitizeOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function sanitizeOptionalInteger(value: unknown): number | null {
  const parsed = sanitizeOptionalNumber(value);
  if (parsed === null) return null;
  return Math.round(parsed);
}

function isIngredient(input: unknown): input is Ingredient {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<Ingredient>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.quantity === "string" &&
    typeof candidate.unit === "string" &&
    typeof candidate.section === "string"
  );
}

function normalizeLocation(input: unknown): RecipePricingLocation {
  if (!input || typeof input !== "object") {
    throw new PricingRouteError(
      "Pricing location is required. Use your current location before refreshing MealMe pricing.",
      400
    );
  }

  const candidate = input as Partial<RecipePricingLocation>;
  const latitude = sanitizeOptionalNumber(candidate.latitude);
  const longitude = sanitizeOptionalNumber(candidate.longitude);

  if (latitude === null || latitude < -90 || latitude > 90) {
    throw new PricingRouteError("Pricing latitude is invalid.", 400);
  }

  if (longitude === null || longitude < -180 || longitude > 180) {
    throw new PricingRouteError("Pricing longitude is invalid.", 400);
  }

  return {
    latitude,
    longitude,
    accuracyMeters: sanitizeOptionalNumber(candidate.accuracyMeters),
    capturedAt:
      typeof candidate.capturedAt === "string" && Number.isFinite(Date.parse(candidate.capturedAt))
        ? candidate.capturedAt
        : new Date().toISOString(),
  };
}

function buildSearchQuery(ingredientName: string): string {
  const cleaned = SEARCH_CLEANUP_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    ingredientName
  );

  return cleanText(cleaned) || cleanText(ingredientName);
}

function getCachedPromise<K, V>(
  cache: Map<K, { expiresAt: number; value: Promise<V> }>,
  key: K,
  loader: () => Promise<V>
): Promise<V> {
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
    expiresAt: now + MEALME_SEARCH_CACHE_TTL_MS,
    value,
  });

  return value;
}

function buildSearchCacheKey(query: string, location: RecipePricingLocation): string {
  return `${query.toLowerCase()}|${location.latitude.toFixed(3)}|${location.longitude.toFixed(3)}`;
}

function formatPackageSize(unitSize: number | undefined, unitOfMeasurement: string | undefined): string | undefined {
  if (!unitOfMeasurement || typeof unitSize !== "number" || !Number.isFinite(unitSize) || unitSize <= 0) {
    return undefined;
  }

  const printableAmount =
    Math.abs(unitSize - Math.round(unitSize)) < 0.001
      ? String(Math.round(unitSize))
      : String(roundToCents(unitSize));

  return `${printableAmount} ${cleanText(unitOfMeasurement)}`;
}

function parseMealMeProduct(input: unknown): MealMeProduct | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const itemName = sanitizeOptionalText(candidate.item_name);
  const priceCents = sanitizeOptionalInteger(candidate.price);
  if (!itemName || priceCents === null || priceCents <= 0) return null;

  const unitSize = sanitizeOptionalNumber(candidate.unit_size) ?? undefined;
  const unitOfMeasurement = sanitizeOptionalText(candidate.unit_of_measurement);
  const store =
    candidate.store && typeof candidate.store === "object"
      ? (candidate.store as Record<string, unknown>)
      : undefined;

  return {
    productId: sanitizeOptionalText(candidate.product_id),
    itemName,
    description: sanitizeOptionalText(candidate.description),
    category: sanitizeOptionalText(candidate.category),
    formattedPrice: sanitizeOptionalText(candidate.formatted_price),
    packageSizeText: formatPackageSize(unitSize, unitOfMeasurement),
    priceCents,
    storeName: sanitizeOptionalText(store?.name),
    storeType: sanitizeOptionalText(store?.type),
    unitOfMeasurement,
    unitSize,
  };
}

async function searchMealMeProducts(
  ingredientName: string,
  location: RecipePricingLocation
): Promise<MealMeProduct[]> {
  const token = process.env.MEALME_ID_TOKEN?.trim();
  if (!token) {
    throw new PricingRouteError(
      "MealMe pricing is not configured on this deployment. Add MEALME_ID_TOKEN in Vercel before using recipe pricing.",
      503
    );
  }

  const query = buildSearchQuery(ingredientName);
  const cacheKey = buildSearchCacheKey(query, location);

  return getCachedPromise(searchCache, cacheKey, async () => {
    const url = new URL("/search/product/v4", MEALME_API_BASE_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("user_latitude", String(location.latitude));
    url.searchParams.set("user_longitude", String(location.longitude));
    url.searchParams.set("pickup", "false");
    url.searchParams.set("fuzzy_search", "true");
    url.searchParams.set("sort", "relevance");
    url.searchParams.set("maximum_miles", "10");
    url.searchParams.set("use_new_db", "true");

    const response = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "Id-Token": token,
      },
      cache: "no-store",
    });

    let payload: MealMeSearchResponse | null = null;
    try {
      payload = (await response.json()) as MealMeSearchResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = sanitizeOptionalText(payload?.error);

      if (response.status === 401 || response.status === 403) {
        throw new PricingRouteError(
          providerMessage ??
            "MealMe rejected the configured Id-Token. Check the MEALME_ID_TOKEN value in Vercel.",
          503
        );
      }

      throw new PricingRouteError(
        providerMessage ?? `MealMe product search failed with status ${response.status}.`,
        response.status >= 500 ? 502 : response.status
      );
    }

    const products = Array.isArray(payload?.products)
      ? payload.products.map(parseMealMeProduct).filter((product): product is MealMeProduct => Boolean(product))
      : [];

    const deduped: MealMeProduct[] = [];
    const seen = new Set<string>();

    for (const product of products) {
      const key = [
        product.productId,
        product.itemName,
        product.storeName,
        product.priceCents,
        product.packageSizeText,
      ].join("|");

      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(product);

      if (deduped.length >= MEALME_RESULT_LIMIT) break;
    }

    return deduped;
  });
}

function normalizeQuantityText(value: string): string {
  let normalized = value.trim().toLowerCase();

  for (const [fraction, replacement] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replaceAll(fraction, ` ${replacement} `);
  }

  normalized = normalized.replace(/(\d)-(\d\/\d)/g, "$1 $2");
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

function parseFraction(value: string): number | null {
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function parseQuantity(value: string): number | null {
  const normalized = normalizeQuantityText(value);
  if (!normalized) return null;

  const mixedFractionMatch = normalized.match(/^(\d+)\s+(\d+\/\d+)/);
  if (mixedFractionMatch) {
    const whole = Number(mixedFractionMatch[1]);
    const fraction = parseFraction(mixedFractionMatch[2]);
    if (Number.isFinite(whole) && fraction !== null) {
      return whole + fraction;
    }
  }

  const fractionMatch = normalized.match(/^(\d+\/\d+)/);
  if (fractionMatch) {
    return parseFraction(fractionMatch[1]);
  }

  const decimalMatch = normalized.match(/^(\d+(?:\.\d+)?)/);
  if (decimalMatch) {
    const parsed = Number(decimalMatch[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeUnitKey(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

function toMeasurement(
  amount: number,
  rawUnit: string,
  preferredDimension?: MeasurementDimension
): Measurement | null {
  const normalizedUnit = normalizeUnitKey(rawUnit);

  if (COUNT_UNITS.has(normalizedUnit)) {
    return {
      amount,
      baseAmount: amount,
      dimension: "count",
    };
  }

  const volumeFactor = VOLUME_ML_FACTORS[normalizedUnit];
  if (volumeFactor) {
    return {
      amount,
      baseAmount: amount * volumeFactor,
      dimension: "volume",
    };
  }

  const weightFactor = WEIGHT_GRAM_FACTORS[normalizedUnit];
  if (weightFactor) {
    return {
      amount,
      baseAmount: amount * weightFactor,
      dimension: "weight",
    };
  }

  if (AMBIGUOUS_OUNCE_UNITS.has(normalizedUnit)) {
    if (preferredDimension === "volume") {
      return {
        amount,
        baseAmount: amount * 29.5735,
        dimension: "volume",
      };
    }

    if (preferredDimension === "weight") {
      return {
        amount,
        baseAmount: amount * 28.3495,
        dimension: "weight",
      };
    }
  }

  return null;
}

function buildComparableMeasurements(
  ingredient: Ingredient,
  product: MealMeProduct
): { ingredientMeasure: Measurement; productMeasure: Measurement } | null {
  const ingredientAmount = parseQuantity(ingredient.quantity);
  if (ingredientAmount === null || ingredientAmount <= 0) {
    return null;
  }

  const ingredientMeasure = toMeasurement(ingredientAmount, ingredient.unit);
  const productMeasure =
    product.unitSize && product.unitOfMeasurement
      ? toMeasurement(product.unitSize, product.unitOfMeasurement, ingredientMeasure?.dimension)
      : null;

  if (!ingredientMeasure && productMeasure) {
    const resolvedIngredientMeasure = toMeasurement(
      ingredientAmount,
      ingredient.unit,
      productMeasure.dimension
    );

    if (
      resolvedIngredientMeasure &&
      resolvedIngredientMeasure.dimension === productMeasure.dimension
    ) {
      return {
        ingredientMeasure: resolvedIngredientMeasure,
        productMeasure,
      };
    }
  }

  if (!ingredientMeasure || !productMeasure) {
    return null;
  }

  if (ingredientMeasure.dimension !== productMeasure.dimension) {
    return null;
  }

  return {
    ingredientMeasure,
    productMeasure,
  };
}

function tokenize(value: string): string[] {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !TOKEN_STOPWORDS.has(token));
}

function buildSearchText(product: MealMeProduct): string {
  return cleanText(
    [product.itemName, product.description, product.category, product.storeName]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
}

function scoreProduct(
  queryTokens: string[],
  product: MealMeProduct,
  canAdjustPrice: boolean
): number {
  const searchText = buildSearchText(product);
  const matchedTokenCount = queryTokens.filter((token) => searchText.includes(token)).length;

  if (queryTokens.length > 0 && matchedTokenCount === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = matchedTokenCount * 3;

  if (matchedTokenCount === queryTokens.length && queryTokens.length > 0) {
    score += 4;
  }

  if (product.storeType === "grocery") {
    score += 3;
  } else if (product.storeType === "restaurant") {
    score -= 4;
  }

  if (canAdjustPrice) {
    score += 6;
  }

  if (product.packageSizeText) {
    score += 1;
  }

  return score;
}

function buildMatchDetail(product: MealMeProduct): string | undefined {
  const parts = [product.itemName, product.storeName, product.packageSizeText].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function buildUnavailableEstimate(
  ingredient: Ingredient,
  reason: string,
  product?: MealMeProduct
): IngredientPriceEstimate {
  const packagePrice = product ? roundToCents(product.priceCents / 100) : null;

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice: null,
    adjustedPriceText: null,
    packagePrice,
    packagePriceText: packagePrice !== null ? formatUsd(packagePrice) : null,
    packageSizeText: product?.packageSizeText,
    matchTitle: product?.itemName,
    matchStore: product?.storeName,
    confidence: product ? 0.35 : null,
    explanation: product ? buildMatchDetail(product) : undefined,
    unavailableReason: reason,
  };
}

function estimateIngredientPrice(
  ingredient: Ingredient,
  products: MealMeProduct[]
): IngredientPriceEstimate {
  if (products.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "MealMe did not return a nearby grocery match for this ingredient."
    );
  }

  const queryTokens = tokenize(ingredient.name);
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestProduct: MealMeProduct | undefined;
  let bestAdjustedPrice: number | null = null;
  let bestConfidence = 0.3;

  for (const product of products) {
    const comparableMeasurements = buildComparableMeasurements(ingredient, product);
    const canAdjustPrice = Boolean(comparableMeasurements);
    const score = scoreProduct(queryTokens, product, canAdjustPrice);

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;

      if (comparableMeasurements) {
        const packagePrice = product.priceCents / 100;
        bestAdjustedPrice = roundToCents(
          packagePrice *
            (comparableMeasurements.ingredientMeasure.baseAmount /
              comparableMeasurements.productMeasure.baseAmount)
        );
      } else {
        bestAdjustedPrice = null;
      }

      const tokenCoverage =
        queryTokens.length > 0
          ? queryTokens.filter((token) => buildSearchText(product).includes(token)).length /
            queryTokens.length
          : 0.5;

      bestConfidence = clampConfidence(
        (bestAdjustedPrice !== null ? 0.55 : 0.28) +
          tokenCoverage * 0.25 +
          (product.storeType === "grocery" ? 0.1 : 0)
      );
    }
  }

  if (!bestProduct || !Number.isFinite(bestScore)) {
    return buildUnavailableEstimate(
      ingredient,
      "MealMe did not return a confident grocery match for this ingredient."
    );
  }

  const packagePrice = roundToCents(bestProduct.priceCents / 100);
  const matchDetail = buildMatchDetail(bestProduct);

  if (bestAdjustedPrice === null) {
    return buildUnavailableEstimate(
      ingredient,
      "MealMe found a nearby product, but its package size could not be converted to this recipe quantity automatically.",
      bestProduct
    );
  }

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice: bestAdjustedPrice,
    adjustedPriceText: formatUsd(bestAdjustedPrice),
    packagePrice,
    packagePriceText: formatUsd(packagePrice),
    packageSizeText: bestProduct.packageSizeText,
    matchTitle: bestProduct.itemName,
    matchStore: bestProduct.storeName,
    confidence: bestConfidence,
    explanation: matchDetail,
    unavailableReason: null,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function estimateRecipeWithMealMe(input: unknown): Promise<RecipePriceEstimate> {
  const body = (input ?? {}) as RecipePricingRequest;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(isIngredient) : [];

  if (ingredients.length === 0) {
    return {
      provider: "mealme",
      estimatedAt: new Date().toISOString(),
      currencyCode: "USD",
      totalAdjustedPrice: 0,
      totalAdjustedPriceText: formatUsd(0),
      resolvedIngredientCount: 0,
      unresolvedIngredientCount: 0,
      ingredients: [],
    };
  }

  const location = normalizeLocation(body.location);

  const estimates = await mapWithConcurrency(ingredients, 4, async (ingredient) => {
    const products = await searchMealMeProducts(ingredient.name, location);
    return estimateIngredientPrice(ingredient, products);
  });

  const totalAdjustedPrice = roundToCents(
    estimates.reduce((sum, estimate) => sum + (estimate.adjustedPrice ?? 0), 0)
  );
  const resolvedIngredientCount = estimates.filter(
    (estimate) => estimate.adjustedPrice !== null
  ).length;

  return {
    provider: "mealme",
    estimatedAt: new Date().toISOString(),
    currencyCode: "USD",
    totalAdjustedPrice,
    totalAdjustedPriceText: formatUsd(totalAdjustedPrice),
    resolvedIngredientCount,
    unresolvedIngredientCount: estimates.length - resolvedIngredientCount,
    ingredients: estimates,
  };
}
