import {
  IngredientPriceEstimate,
  RecipePriceEstimate,
  RecipePricingRequest,
} from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";

const SPOONACULAR_API_BASE_URL = "https://api.spoonacular.com";
const SPOONACULAR_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const SPOONACULAR_PRODUCT_CANDIDATE_LIMIT = 2;

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
  "packet",
  "packets",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "pkg",
  "serving",
  "servings",
  "sheet",
  "sheets",
  "slice",
  "slices",
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

const ingredientMapCache = new Map<
  string,
  { expiresAt: number; value: Promise<SpoonacularMappedIngredient[]> }
>();

const productCache = new Map<
  number,
  { expiresAt: number; value: Promise<SpoonacularProduct | null> }
>();

type MeasurementDimension = "count" | "volume" | "weight";

interface Measurement {
  amount: number;
  baseAmount: number;
  dimension: MeasurementDimension;
}

interface SpoonacularMappedProduct {
  id: number;
  title: string;
  upc?: string;
}

interface SpoonacularMappedIngredient {
  original?: string;
  originalName?: string;
  products: SpoonacularMappedProduct[];
}

interface SpoonacularProduct {
  productId: number;
  title: string;
  breadcrumbs?: string[];
  packageSizeText?: string;
  priceCents: number;
  servingCount?: number;
  servingSize?: number;
  servingUnit?: string;
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

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => sanitizeOptionalText(entry))
    .filter((entry): entry is string => Boolean(entry));

  return normalized.length > 0 ? normalized : undefined;
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
    expiresAt: now + SPOONACULAR_CACHE_TTL_MS,
    value,
  });

  return value;
}

function buildSearchQuery(ingredientName: string): string {
  const cleaned = SEARCH_CLEANUP_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    ingredientName
  );

  return cleanText(cleaned) || cleanText(ingredientName);
}

function buildIngredientMapCacheKey(ingredients: Ingredient[]): string {
  return ingredients.map((ingredient) => buildSearchQuery(ingredient.name).toLowerCase()).join("|");
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

function parseMappedProduct(input: unknown): SpoonacularMappedProduct | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const id = sanitizeOptionalInteger(candidate.id);
  const title = sanitizeOptionalText(candidate.title);
  if (id === null || id <= 0 || !title) return null;

  return {
    id,
    title,
    upc: sanitizeOptionalText(candidate.upc),
  };
}

function parseMappedIngredient(input: unknown): SpoonacularMappedIngredient {
  if (!input || typeof input !== "object") {
    return { products: [] };
  }

  const candidate = input as Record<string, unknown>;
  const products = Array.isArray(candidate.products)
    ? candidate.products
        .map(parseMappedProduct)
        .filter((product): product is SpoonacularMappedProduct => Boolean(product))
    : [];

  return {
    original: sanitizeOptionalText(candidate.original),
    originalName: sanitizeOptionalText(candidate.originalName),
    products,
  };
}

function parseSpoonacularProduct(input: unknown): SpoonacularProduct | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const productId = sanitizeOptionalInteger(candidate.id);
  const title = sanitizeOptionalText(candidate.title);
  const priceCents = sanitizeOptionalInteger(candidate.price);
  if (productId === null || productId <= 0 || !title || priceCents === null || priceCents <= 0) {
    return null;
  }

  const servings =
    candidate.servings && typeof candidate.servings === "object"
      ? (candidate.servings as Record<string, unknown>)
      : undefined;

  const servingCount = sanitizeOptionalNumber(servings?.number) ?? undefined;
  const servingSize = sanitizeOptionalNumber(servings?.size) ?? undefined;
  const servingUnit = sanitizeOptionalText(servings?.unit) ?? sanitizeOptionalText(servings?.raw);
  const totalSize =
    servingCount && servingSize && Number.isFinite(servingCount * servingSize)
      ? servingCount * servingSize
      : undefined;

  return {
    productId,
    title,
    breadcrumbs: sanitizeStringArray(candidate.breadcrumbs),
    packageSizeText: formatPackageSize(totalSize, servingUnit),
    priceCents,
    servingCount,
    servingSize,
    servingUnit,
  };
}

function extractProviderMessage(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;

  const candidate = input as Record<string, unknown>;
  return (
    sanitizeOptionalText(candidate.message) ??
    sanitizeOptionalText(candidate.error) ??
    sanitizeOptionalText(candidate.status)
  );
}

function getApiKey(): string {
  const apiKey = process.env.SPOONACULAR_API_KEY?.trim();
  if (!apiKey) {
    throw new PricingRouteError(
      "Spoonacular pricing is not configured on this deployment. Add SPOONACULAR_API_KEY in Vercel before using recipe pricing.",
      503
    );
  }

  return apiKey;
}

async function mapIngredientsToProducts(ingredients: Ingredient[]): Promise<SpoonacularMappedIngredient[]> {
  const apiKey = getApiKey();
  const cacheKey = buildIngredientMapCacheKey(ingredients);

  return getCachedPromise(ingredientMapCache, cacheKey, async () => {
    const response = await fetch(`${SPOONACULAR_API_BASE_URL}/food/ingredients/map`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        ingredients: ingredients.map((ingredient) => buildSearchQuery(ingredient.name)),
        servings: 1,
      }),
      cache: "no-store",
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = extractProviderMessage(payload);

      if (response.status === 401 || response.status === 403) {
        throw new PricingRouteError(
          providerMessage ??
            "Spoonacular rejected the configured API key. Check the SPOONACULAR_API_KEY value in Vercel.",
          503
        );
      }

      if (response.status === 402) {
        throw new PricingRouteError(
          providerMessage ??
            "Spoonacular's daily quota is exhausted for this API key. Try again after the quota resets.",
          503
        );
      }

      throw new PricingRouteError(
        providerMessage ?? `Spoonacular ingredient mapping failed with status ${response.status}.`,
        response.status >= 500 ? 502 : response.status
      );
    }

    const mappedIngredients = Array.isArray(payload) ? payload.map(parseMappedIngredient) : [];

    if (mappedIngredients.length >= ingredients.length) {
      return mappedIngredients.slice(0, ingredients.length);
    }

    return [
      ...mappedIngredients,
      ...Array.from({ length: ingredients.length - mappedIngredients.length }, () => ({ products: [] })),
    ];
  });
}

async function getProductDetails(productId: number): Promise<SpoonacularProduct | null> {
  const apiKey = getApiKey();

  return getCachedPromise(productCache, productId, async () => {
    const response = await fetch(`${SPOONACULAR_API_BASE_URL}/food/products/${productId}`, {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = extractProviderMessage(payload);

      if (response.status === 401 || response.status === 403) {
        throw new PricingRouteError(
          providerMessage ??
            "Spoonacular rejected the configured API key. Check the SPOONACULAR_API_KEY value in Vercel.",
          503
        );
      }

      if (response.status === 402) {
        throw new PricingRouteError(
          providerMessage ??
            "Spoonacular's daily quota is exhausted for this API key. Try again after the quota resets.",
          503
        );
      }

      if (response.status === 404) {
        return null;
      }

      throw new PricingRouteError(
        providerMessage ?? `Spoonacular product lookup failed with status ${response.status}.`,
        response.status >= 500 ? 502 : response.status
      );
    }

    return parseSpoonacularProduct(payload);
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
  product: SpoonacularProduct
): { ingredientMeasure: Measurement; productMeasure: Measurement } | null {
  const ingredientAmount = parseQuantity(ingredient.quantity);
  if (ingredientAmount === null || ingredientAmount <= 0) {
    return null;
  }

  const ingredientMeasure = toMeasurement(ingredientAmount, ingredient.unit);
  const totalProductAmount =
    product.servingCount && product.servingSize ? product.servingCount * product.servingSize : null;
  const productMeasure =
    totalProductAmount && product.servingUnit
      ? toMeasurement(totalProductAmount, product.servingUnit, ingredientMeasure?.dimension)
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

function buildSearchText(product: SpoonacularProduct): string {
  return cleanText([product.title, ...(product.breadcrumbs ?? [])].filter(Boolean).join(" ")).toLowerCase();
}

function scoreProduct(
  queryTokens: string[],
  product: SpoonacularProduct,
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

  if (canAdjustPrice) {
    score += 6;
  }

  if (product.packageSizeText) {
    score += 1;
  }

  return score;
}

function buildMatchDetail(product: SpoonacularProduct): string | undefined {
  const parts = [product.title, product.packageSizeText].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function buildUnavailableEstimate(
  ingredient: Ingredient,
  reason: string,
  product?: SpoonacularProduct
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
    matchTitle: product?.title,
    confidence: product ? 0.35 : null,
    explanation: product ? buildMatchDetail(product) : undefined,
    unavailableReason: reason,
  };
}

function estimateIngredientPrice(
  ingredient: Ingredient,
  products: SpoonacularProduct[]
): IngredientPriceEstimate {
  if (products.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Spoonacular did not return a usable grocery product for this ingredient."
    );
  }

  const queryTokens = tokenize(ingredient.name);
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestProduct: SpoonacularProduct | undefined;
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
        (bestAdjustedPrice !== null ? 0.58 : 0.28) + tokenCoverage * 0.25
      );
    }
  }

  if (!bestProduct || !Number.isFinite(bestScore)) {
    return buildUnavailableEstimate(
      ingredient,
      "Spoonacular did not return a confident grocery match for this ingredient."
    );
  }

  const packagePrice = roundToCents(bestProduct.priceCents / 100);
  const matchDetail = buildMatchDetail(bestProduct);

  if (bestAdjustedPrice === null) {
    return buildUnavailableEstimate(
      ingredient,
      "Spoonacular found a product, but its package size could not be converted to this recipe quantity automatically.",
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
    matchTitle: bestProduct.title,
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

export async function estimateRecipeWithSpoonacular(input: unknown): Promise<RecipePriceEstimate> {
  const body = (input ?? {}) as RecipePricingRequest;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(isIngredient) : [];

  if (ingredients.length === 0) {
    return {
      provider: "spoonacular",
      estimatedAt: new Date().toISOString(),
      currencyCode: "USD",
      totalAdjustedPrice: 0,
      totalAdjustedPriceText: formatUsd(0),
      resolvedIngredientCount: 0,
      unresolvedIngredientCount: 0,
      ingredients: [],
    };
  }

  const mappedIngredients = await mapIngredientsToProducts(ingredients);

  const estimates = await mapWithConcurrency(
    ingredients.map((ingredient, index) => ({
      ingredient,
      candidates: mappedIngredients[index]?.products.slice(0, SPOONACULAR_PRODUCT_CANDIDATE_LIMIT) ?? [],
    })),
    4,
    async ({ ingredient, candidates }) => {
      const products = (
        await mapWithConcurrency(candidates, SPOONACULAR_PRODUCT_CANDIDATE_LIMIT, async (candidate) =>
          getProductDetails(candidate.id)
        )
      ).filter((product): product is SpoonacularProduct => Boolean(product));

      return estimateIngredientPrice(ingredient, products);
    }
  );

  const totalAdjustedPrice = roundToCents(
    estimates.reduce((sum, estimate) => sum + (estimate.adjustedPrice ?? 0), 0)
  );
  const resolvedIngredientCount = estimates.filter(
    (estimate) => estimate.adjustedPrice !== null
  ).length;

  return {
    provider: "spoonacular",
    estimatedAt: new Date().toISOString(),
    currencyCode: "USD",
    totalAdjustedPrice,
    totalAdjustedPriceText: formatUsd(totalAdjustedPrice),
    resolvedIngredientCount,
    unresolvedIngredientCount: estimates.length - resolvedIngredientCount,
    ingredients: estimates,
  };
}
