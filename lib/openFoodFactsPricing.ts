import Anthropic from "@anthropic-ai/sdk";
import {
  IngredientPriceEstimate,
  RecipePriceEstimate,
  RecipePricingRequest,
} from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";

const OPEN_PRICES_API_BASE_URL = "https://prices.openfoodfacts.org/api/v1";
const OPEN_PRICES_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const OPEN_PRICES_USER_AGENT =
  "cooking-be-easy/1.0 (recipe pricing lookup; https://cooking-be-easy.vercel.app)";
const PRODUCT_SEARCH_LIMIT = 10;
const PRODUCT_PRICING_LOOKUP_LIMIT = 3;
const SEARCH_QUERY_LIMIT = 4;

const anthropic = process.env.ANTHROPIC_API_KEY?.trim() ? new Anthropic() : null;

const SEARCH_CLEANUP_PATTERNS = [
  /\([^)]*\)/g,
  /\bfor serving\b/gi,
  /\bfor garnish\b/gi,
  /\bfor the garnish\b/gi,
  /\bdivided\b/gi,
  /\bto taste\b/gi,
  /\bplus more\b[\w\s-]*/gi,
  /\bas needed\b/gi,
  /\bfreshly\b/gi,
  /\bfinely\b/gi,
  /\bthinly\b/gi,
  /\broughly\b/gi,
  /\bcoarsely\b/gi,
  /[,+/]/g,
] as const;

const HEURISTIC_QUERY_REPLACEMENTS: Array<{ pattern: RegExp; queries: string[] }> = [
  {
    pattern: /\bscallions?\b/i,
    queries: ["scallions", "green onions", "spring onions"],
  },
  {
    pattern: /\bgreen onions?\b/i,
    queries: ["green onions", "scallions", "spring onions"],
  },
  {
    pattern: /\bspring onions?\b/i,
    queries: ["spring onions", "scallions", "green onions"],
  },
  {
    pattern: /\bchili flakes?\b/i,
    queries: ["red chili flakes", "chili flakes", "red pepper flakes", "crushed red pepper"],
  },
  {
    pattern: /\bred pepper flakes?\b/i,
    queries: ["red pepper flakes", "red chili flakes", "chili flakes", "crushed red pepper"],
  },
  {
    pattern: /\bneutral oil\b/i,
    queries: ["avocado oil", "vegetable oil", "canola oil", "neutral oil"],
  },
  {
    pattern: /\ball purpose flour\b/i,
    queries: ["all purpose flour", "all-purpose flour", "plain flour", "flour"],
  },
  {
    pattern: /\bcaster sugar\b/i,
    queries: ["caster sugar", "superfine sugar", "sugar"],
  },
  {
    pattern: /\bconfectioners?(?:'|) sugar\b/i,
    queries: ["powdered sugar", "confectioners sugar", "icing sugar"],
  },
];

const PARENTHETICAL_QUERY_HINT_PATTERNS = [
  /\b([a-z][a-z\s-]{1,30}\s+oil)\b/i,
  /\b([a-z][a-z\s-]{1,30}\s+vinegar)\b/i,
  /\b([a-z][a-z\s-]{1,30}\s+flour)\b/i,
  /\b([a-z][a-z\s-]{1,30}\s+sauce)\b/i,
  /\b([a-z][a-z\s-]{1,30}\s+sugar)\b/i,
  /\b([a-z][a-z\s-]{1,30}\s+flakes)\b/i,
];

const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "extra",
  "for",
  "fresh",
  "large",
  "medium",
  "of",
  "optional",
  "small",
  "the",
  "unsalted",
  "with",
]);

const PREPARED_PRODUCT_HINTS = [
  "bars",
  "biscuits",
  "bread",
  "breads",
  "brownies",
  "cake",
  "cakes",
  "candy",
  "candies",
  "cereal-bars",
  "breakfast-biscuit",
  "breakfast-cereals",
  "breakfasts",
  "chips",
  "chocolate",
  "cookies",
  "crisps",
  "crispy",
  "desserts",
  "dishes",
  "frozen-meals",
  "granola-bars",
  "ice-creams",
  "instant-noodles",
  "meals",
  "oatmeal",
  "porridge",
  "pastries",
  "pizza",
  "ready-meals",
  "sandwiches",
  "soups",
  "toaster-pastries",
  "fried",
  "mayonnaise",
  "mayo",
  "spread",
];

const LIQUID_PRODUCT_HINTS = [
  "broth",
  "broths",
  "condiments",
  "dressings",
  "juice",
  "juices",
  "milk",
  "milks",
  "oil",
  "oils",
  "sauce",
  "sauces",
  "soy-sauces",
  "stocks",
  "vinegar",
  "vinegars",
];

const WEIGHT_PRODUCT_HINTS = [
  "baking-mixes",
  "beans",
  "breadcrumbs",
  "cereals",
  "cheese",
  "cheeses",
  "flour",
  "flours",
  "grain",
  "grains",
  "herbs",
  "meat",
  "meats",
  "pasta",
  "pepper",
  "rice",
  "seasoning",
  "seasonings",
  "spice",
  "spices",
  "sugar",
  "sugars",
];

const SECTION_CATEGORY_HINTS: Record<Ingredient["section"], string[]> = {
  Produce: ["fruits", "vegetables", "herbs", "mushrooms", "produce"],
  "Meat & Seafood": ["meat", "meats", "poultry", "seafood", "fish"],
  "Dairy & Eggs": ["dairy", "cheese", "cheeses", "milk", "milks", "eggs", "butter", "yogurts"],
  Bakery: ["bakery", "breads", "bread", "bagels", "tortillas"],
  "Pantry & Dry Goods": ["groceries", "rice", "pasta", "beans", "legumes", "flours", "grains"],
  "Frozen Foods": ["frozen-foods", "frozen-meals", "ice-creams"],
  Beverages: ["beverages", "juices", "tea", "coffee", "sodas", "waters"],
  Snacks: ["snacks", "chips", "crisps", "cookies", "crackers", "bars"],
  "Condiments & Sauces": ["condiments", "sauces", "soy-sauces", "dressings", "oils", "vinegars"],
  "Spices & Baking": [
    "spices",
    "herbs",
    "seasonings",
    "flours",
    "baking-mixes",
    "sweeteners",
    "sugars",
    "brown-sugars",
  ],
  Deli: ["deli", "prepared-meats", "cold-cuts"],
  Other: [],
};

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
  cup: 236.588,
  cups: 236.588,
  "fl oz": 29.5735,
  "fluid ounce": 29.5735,
  "fluid ounces": 29.5735,
  floz: 29.5735,
  gallon: 3785.41,
  gallons: 3785.41,
  gal: 3785.41,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  pint: 473.176,
  pints: 473.176,
  pt: 473.176,
  quart: 946.353,
  quarts: 946.353,
  qt: 946.353,
  tablespoon: 14.7868,
  tablespoons: 14.7868,
  tbsp: 14.7868,
  tbsps: 14.7868,
  teaspoon: 4.92892,
  teaspoons: 4.92892,
  tsp: 4.92892,
  tsps: 4.92892,
};

const WEIGHT_GRAM_FACTORS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  lb: 453.592,
  lbs: 453.592,
  pound: 453.592,
  pounds: 453.592,
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

const DENSITY_OVERRIDES: Array<{ pattern: RegExp; gramsPerMilliliter: number }> = [
  { pattern: /\bnutritional yeast\b/i, gramsPerMilliliter: 0.17 },
  {
    pattern: /\b(powdered sugar|confectioners sugar|confectioners' sugar|icing sugar)\b/i,
    gramsPerMilliliter: 0.47,
  },
  { pattern: /\bcocoa powder\b/i, gramsPerMilliliter: 0.53 },
  { pattern: /\b(baking powder|baking soda)\b/i, gramsPerMilliliter: 0.9 },
  {
    pattern:
      /\b(cinnamon|paprika|cumin|turmeric|coriander|garlic powder|onion powder|chili powder|cayenne|pepper|allspice|nutmeg|ginger|clove)\b/i,
    gramsPerMilliliter: 0.5,
  },
  {
    pattern:
      /\b(parsley|oregano|thyme|basil|rosemary|dill|sage|tarragon|marjoram|mint|chives)\b/i,
    gramsPerMilliliter: 0.16,
  },
  { pattern: /\bflour\b/i, gramsPerMilliliter: 0.53 },
  { pattern: /\b(sugar|brown sugar)\b/i, gramsPerMilliliter: 0.85 },
  { pattern: /\boats?\b/i, gramsPerMilliliter: 0.35 },
  { pattern: /\brice\b/i, gramsPerMilliliter: 0.85 },
  { pattern: /\bbreadcrumbs?\b/i, gramsPerMilliliter: 0.43 },
] as const;

const productSearchCache = new Map<
  string,
  { expiresAt: number; value: Promise<OpenPricesProduct[]> }
>();
const productPricingCache = new Map<
  number,
  { expiresAt: number; value: Promise<OpenPricesProductPricing | null> }
>();
const ingredientSearchPlanCache = new Map<
  string,
  { expiresAt: number; value: Promise<Map<string, IngredientSearchPlan>> }
>();

type MeasurementDimension = "count" | "volume" | "weight";

interface Measurement {
  amount: number;
  baseAmount: number;
  dimension: MeasurementDimension;
}

interface OpenPricesProduct {
  id: number;
  code?: string;
  productName: string;
  productQuantity: number | null;
  productQuantityUnit?: string;
  categoriesTags: string[];
  brands?: string;
  priceCount: number;
}

interface OpenPricesStats {
  priceCount: number;
  minimumPrice: number | null;
  maximumPrice: number | null;
  averagePrice: number | null;
}

interface OpenPricesPriceRecord {
  price: number;
  currency: string;
  date?: string;
  storeName?: string;
  countryCode?: string;
}

interface OpenPricesProductPricing {
  stats: OpenPricesStats;
  latestPrice: OpenPricesPriceRecord | null;
}

interface ProductPackageMeasurement {
  amount: number;
  unit: string;
  displayText: string;
  inferredUnit: boolean;
}

interface ComparableMeasurements {
  ingredientMeasure: Measurement;
  productMeasure: Measurement;
  packageSizeText?: string;
  inferredUnit: boolean;
  usedApproximateDensity: boolean;
}

interface PreliminaryProductMatch {
  product: OpenPricesProduct;
  score: number;
  tokenCoverage: number;
  exactPhraseMatch: boolean;
  sectionBonus: number;
}

interface ScoredProductMatch extends PreliminaryProductMatch {
  pricing: OpenPricesProductPricing;
  comparableMeasurements: ComparableMeasurements | null;
  finalScore: number;
}

interface IngredientSearchPlan {
  ingredientId: string;
  canonicalName: string;
  searchQueries: string[];
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

function normalizeText(value: string): string {
  return cleanText(value).toLowerCase();
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

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => sanitizeOptionalText(entry))
    .filter((entry): entry is string => Boolean(entry));
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
    expiresAt: now + OPEN_PRICES_CACHE_TTL_MS,
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

function normalizeSearchTerm(value: string): string {
  return cleanText(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
  );
}

function dedupeQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeSearchTerm(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function extractParentheticalSearchHints(ingredientName: string): string[] {
  const hints: string[] = [];
  const matches = ingredientName.match(/\(([^)]+)\)/g) ?? [];

  for (const rawMatch of matches) {
    const inner = rawMatch.slice(1, -1);
    for (const pattern of PARENTHETICAL_QUERY_HINT_PATTERNS) {
      const match = inner.match(pattern);
      if (match?.[1]) {
        hints.push(match[1]);
      }
    }
  }

  return hints;
}

function buildHeuristicSearchPlan(ingredient: Ingredient): IngredientSearchPlan {
  const baseQuery = buildSearchQuery(ingredient.name);
  const queries = [baseQuery, ...extractParentheticalSearchHints(ingredient.name)];

  for (const replacement of HEURISTIC_QUERY_REPLACEMENTS) {
    if (replacement.pattern.test(ingredient.name) || replacement.pattern.test(baseQuery)) {
      queries.unshift(...replacement.queries);
    }
  }

  const dedupedQueries = dedupeQueries(queries).slice(0, SEARCH_QUERY_LIMIT);
  const canonicalName = dedupedQueries[0] || normalizeSearchTerm(baseQuery) || "ingredient";

  return {
    ingredientId: ingredient.id,
    canonicalName,
    searchQueries: dedupedQueries.length > 0 ? dedupedQueries : [canonicalName],
  };
}

function getIngredientSearchPlanCacheKey(ingredients: Ingredient[]): string {
  return ingredients
    .map((ingredient) =>
      [
        ingredient.id,
        normalizeSearchTerm(ingredient.name),
        normalizeSearchTerm(ingredient.section),
        normalizeSearchTerm(ingredient.unit),
      ].join(":")
    )
    .join("|");
}

function parseIngredientSearchPlansResponse(
  text: string,
  ingredients: Ingredient[]
): Map<string, IngredientSearchPlan> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse ingredient search plans");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    plans?: Array<{
      ingredientId?: unknown;
      canonicalName?: unknown;
      searchQueries?: unknown;
    }>;
  };

  const ingredientIds = new Set(ingredients.map((ingredient) => ingredient.id));
  const plans = new Map<string, IngredientSearchPlan>();

  if (!Array.isArray(parsed.plans)) {
    return plans;
  }

  for (const entry of parsed.plans) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.ingredientId !== "string" || !ingredientIds.has(entry.ingredientId)) {
      continue;
    }

    const canonicalName =
      typeof entry.canonicalName === "string"
        ? normalizeSearchTerm(entry.canonicalName)
        : "";
    const searchQueries = Array.isArray(entry.searchQueries)
      ? dedupeQueries(
          entry.searchQueries.filter(
            (query): query is string => typeof query === "string"
          )
        )
      : [];

    if (!canonicalName && searchQueries.length === 0) {
      continue;
    }

    plans.set(entry.ingredientId, {
      ingredientId: entry.ingredientId,
      canonicalName: canonicalName || searchQueries[0],
      searchQueries: (searchQueries.length > 0 ? searchQueries : [canonicalName]).slice(
        0,
        SEARCH_QUERY_LIMIT
      ),
    });
  }

  return plans;
}

async function inferIngredientSearchPlansWithAi(
  ingredients: Ingredient[]
): Promise<Map<string, IngredientSearchPlan>> {
  if (!anthropic || ingredients.length === 0) {
    return new Map();
  }

  const cacheKey = getIngredientSearchPlanCacheKey(ingredients);

  return getCachedPromise(ingredientSearchPlanCache, cacheKey, async () => {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Turn these recipe ingredients into grocery search plans for Open Food Facts Open Prices.

Each ingredient needs:
- canonicalName: the short, generic grocery item name
- searchQueries: 2 to 4 short search phrases, ordered best to fallback

Rules:
- Remove prep notes, garnish notes, and cooking instructions.
- Keep the actual grocery item identity.
- Prefer the most likely specific product if the ingredient suggests one in parentheses.
- Use lowercase only.
- Queries must be short grocery phrases, not sentences.
- Do not include quantities, units, brand names, or packaging sizes.
- Include common grocery synonyms when they help:
  - scallions -> green onions / spring onions
  - chili flakes -> red pepper flakes / red chili flakes
  - neutral oil -> avocado oil / vegetable oil / canola oil
- Do not invent exotic substitutes. Keep it practical for grocery-store product search.

Ingredients:
${JSON.stringify(
  ingredients.map((ingredient) => ({
    ingredientId: ingredient.id,
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    section: ingredient.section,
  })),
  null,
  2
)}

Return ONLY valid JSON in exactly this format:
{
  "plans": [
    {
      "ingredientId": "id",
      "canonicalName": "generic grocery item",
      "searchQueries": ["best query", "fallback query"]
    }
  ]
}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock ? textBlock.text : "";
    return parseIngredientSearchPlansResponse(text, ingredients);
  });
}

async function buildIngredientSearchPlans(
  ingredients: Ingredient[]
): Promise<Map<string, IngredientSearchPlan>> {
  const heuristicPlans = new Map(
    ingredients.map((ingredient) => [ingredient.id, buildHeuristicSearchPlan(ingredient)])
  );

  let aiPlans = new Map<string, IngredientSearchPlan>();
  try {
    aiPlans = await inferIngredientSearchPlansWithAi(ingredients);
  } catch (error) {
    console.error("Ingredient search plan normalization failed:", error);
  }

  const mergedPlans = new Map<string, IngredientSearchPlan>();

  for (const ingredient of ingredients) {
    const heuristicPlan = heuristicPlans.get(ingredient.id) ?? buildHeuristicSearchPlan(ingredient);
    const aiPlan = aiPlans.get(ingredient.id);

    if (!aiPlan) {
      mergedPlans.set(ingredient.id, heuristicPlan);
      continue;
    }

    const searchQueries = dedupeQueries([
      ...aiPlan.searchQueries,
      aiPlan.canonicalName,
      ...heuristicPlan.searchQueries,
      heuristicPlan.canonicalName,
    ]).slice(0, SEARCH_QUERY_LIMIT);

    mergedPlans.set(ingredient.id, {
      ingredientId: ingredient.id,
      canonicalName: aiPlan.canonicalName || heuristicPlan.canonicalName,
      searchQueries: searchQueries.length > 0 ? searchQueries : heuristicPlan.searchQueries,
    });
  }

  return mergedPlans;
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !TOKEN_STOPWORDS.has(token));
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

function parseSingleQuantity(value: string): number | null {
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

  const decimalMatch = normalized.match(/^((?:\d*\.\d+)|(?:\d+))/);
  if (decimalMatch) {
    const parsed = Number(decimalMatch[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseQuantity(value: string): number | null {
  const normalized = normalizeQuantityText(value);
  if (!normalized) return null;

  const rangeMatch = normalized.match(
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\.\d+)|(?:\d+))\s*(?:-|to)\s*((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\.\d+)|(?:\d+))$/
  );
  if (rangeMatch) {
    const start = parseSingleQuantity(rangeMatch[1]);
    const end = parseSingleQuantity(rangeMatch[2]);
    if (start !== null && end !== null) {
      return (start + end) / 2;
    }
  }

  return parseSingleQuantity(normalized);
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

function getDensityEstimate(ingredient: Ingredient): number | null {
  const normalizedName = cleanText(ingredient.name).toLowerCase();

  for (const override of DENSITY_OVERRIDES) {
    if (override.pattern.test(normalizedName)) {
      return override.gramsPerMilliliter;
    }
  }

  if (ingredient.section === "Spices & Baking") {
    if (/\b(dried|leaf|flakes?|herb)\b/i.test(normalizedName)) {
      return 0.16;
    }

    return 0.4;
  }

  return null;
}

function convertMeasurementDimension(
  measurement: Measurement,
  targetDimension: MeasurementDimension,
  gramsPerMilliliter: number
): Measurement | null {
  if (!Number.isFinite(gramsPerMilliliter) || gramsPerMilliliter <= 0) {
    return null;
  }

  if (measurement.dimension === targetDimension) {
    return measurement;
  }

  if (measurement.dimension === "volume" && targetDimension === "weight") {
    return {
      amount: measurement.amount,
      baseAmount: measurement.baseAmount * gramsPerMilliliter,
      dimension: "weight",
    };
  }

  if (measurement.dimension === "weight" && targetDimension === "volume") {
    return {
      amount: measurement.amount,
      baseAmount: measurement.baseAmount / gramsPerMilliliter,
      dimension: "volume",
    };
  }

  return null;
}

function formatPackageSize(amount: number, unit: string): string {
  const printableAmount =
    Math.abs(amount - Math.round(amount)) < 0.001
      ? String(Math.round(amount))
      : String(roundToCents(amount));
  return `${printableAmount} ${cleanText(unit)}`;
}

function parseProduct(input: unknown): OpenPricesProduct | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const id = sanitizeOptionalInteger(candidate.id);
  const productName = sanitizeOptionalText(candidate.product_name);
  if (id === null || id <= 0 || !productName) return null;

  return {
    id,
    code: sanitizeOptionalText(candidate.code),
    productName,
    productQuantity: sanitizeOptionalNumber(candidate.product_quantity),
    productQuantityUnit: sanitizeOptionalText(candidate.product_quantity_unit),
    categoriesTags: sanitizeStringArray(candidate.categories_tags),
    brands: sanitizeOptionalText(candidate.brands),
    priceCount: sanitizeOptionalInteger(candidate.price_count) ?? 0,
  };
}

function parseProductList(payload: unknown): OpenPricesProduct[] {
  if (!payload || typeof payload !== "object") return [];
  const items = Array.isArray((payload as Record<string, unknown>).items)
    ? ((payload as Record<string, unknown>).items as unknown[])
    : [];

  return items
    .map(parseProduct)
    .filter((product): product is OpenPricesProduct => Boolean(product));
}

function parsePriceStats(payload: unknown): OpenPricesStats {
  if (!payload || typeof payload !== "object") {
    return {
      priceCount: 0,
      minimumPrice: null,
      maximumPrice: null,
      averagePrice: null,
    };
  }

  const candidate = payload as Record<string, unknown>;
  return {
    priceCount: sanitizeOptionalInteger(candidate.price__count) ?? 0,
    minimumPrice: sanitizeOptionalNumber(candidate.price__min),
    maximumPrice: sanitizeOptionalNumber(candidate.price__max),
    averagePrice: sanitizeOptionalNumber(candidate.price__avg),
  };
}

function parsePriceRecord(input: unknown): OpenPricesPriceRecord | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const price = sanitizeOptionalNumber(candidate.price);
  const currency = sanitizeOptionalText(candidate.currency);
  if (price === null || price <= 0 || !currency) return null;

  const location =
    candidate.location && typeof candidate.location === "object"
      ? (candidate.location as Record<string, unknown>)
      : undefined;

  return {
    price,
    currency,
    date: sanitizeOptionalText(candidate.date),
    storeName: sanitizeOptionalText(location?.osm_name),
    countryCode: sanitizeOptionalText(location?.osm_address_country_code)?.toUpperCase(),
  };
}

function parsePriceList(payload: unknown): OpenPricesPriceRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const items = Array.isArray((payload as Record<string, unknown>).items)
    ? ((payload as Record<string, unknown>).items as unknown[])
    : [];

  return items
    .map(parsePriceRecord)
    .filter((record): record is OpenPricesPriceRecord => Boolean(record));
}

function extractProviderMessage(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;

  const candidate = input as Record<string, unknown>;
  return (
    sanitizeOptionalText(candidate.detail) ??
    sanitizeOptionalText(candidate.message) ??
    sanitizeOptionalText(candidate.error) ??
    sanitizeOptionalText(candidate.status)
  );
}

async function fetchOpenPricesJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": OPEN_PRICES_USER_AGENT,
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
    throw new PricingRouteError(
      providerMessage ?? `Open Food Facts Open Prices request failed with status ${response.status}.`,
      response.status >= 500 ? 502 : response.status
    );
  }

  return payload;
}

async function searchProductsForQuery(query: string): Promise<OpenPricesProduct[]> {
  const normalizedQuery = normalizeSearchTerm(query);

  return getCachedPromise(productSearchCache, normalizedQuery, async () => {
    const searchParams = new URLSearchParams({
      product_name__like: normalizedQuery,
      price_count__gte: "1",
      size: String(PRODUCT_SEARCH_LIMIT),
    });

    const payload = await fetchOpenPricesJson(
      `${OPEN_PRICES_API_BASE_URL}/products?${searchParams.toString()}`
    );

    return parseProductList(payload);
  });
}

async function searchProducts(searchPlan: IngredientSearchPlan): Promise<OpenPricesProduct[]> {
  const results = await mapWithConcurrency(
    searchPlan.searchQueries.slice(0, SEARCH_QUERY_LIMIT),
    2,
    (query) => searchProductsForQuery(query)
  );

  const productsById = new Map<number, OpenPricesProduct>();
  for (const group of results) {
    for (const product of group) {
      if (!productsById.has(product.id)) {
        productsById.set(product.id, product);
      }
    }
  }

  return Array.from(productsById.values());
}

async function getProductPricing(productId: number): Promise<OpenPricesProductPricing | null> {
  return getCachedPromise(productPricingCache, productId, async () => {
    const statsParams = new URLSearchParams({
      product_id: String(productId),
      currency: "USD",
    });
    const latestPriceParams = new URLSearchParams({
      product_id: String(productId),
      currency: "USD",
      size: "1",
      order_by: "-date",
    });

    const [statsPayload, latestPricePayload] = await Promise.all([
      fetchOpenPricesJson(`${OPEN_PRICES_API_BASE_URL}/prices/stats?${statsParams.toString()}`),
      fetchOpenPricesJson(`${OPEN_PRICES_API_BASE_URL}/prices?${latestPriceParams.toString()}`),
    ]);

    const stats = parsePriceStats(statsPayload);
    if (stats.priceCount <= 0 || stats.averagePrice === null) {
      return null;
    }

    const latestPrice = parsePriceList(latestPricePayload)[0] ?? null;
    return { stats, latestPrice };
  });
}

function buildProductSearchText(product: OpenPricesProduct): string {
  return normalizeText(
    [product.productName, product.brands, ...product.categoriesTags].filter(Boolean).join(" ")
  );
}

function countMatchingTokens(ingredientTokens: string[], searchText: string): number {
  return ingredientTokens.filter((token) => searchText.includes(token)).length;
}

function includesHint(values: string[], hints: string[]): boolean {
  return values.some((value) => hints.some((hint) => value.includes(hint)));
}

function scorePreparedFoodPenalty(ingredient: Ingredient, product: OpenPricesProduct): number {
  if (ingredient.section === "Bakery" || ingredient.section === "Snacks" || ingredient.section === "Frozen Foods") {
    return 0;
  }

  const haystacks = [normalizeText(product.productName), ...product.categoriesTags.map(normalizeText)];
  if (includesHint(haystacks, PREPARED_PRODUCT_HINTS)) {
    return -18;
  }

  return 0;
}

function scoreSparseCategoryPenalty(ingredient: Ingredient, product: OpenPricesProduct): number {
  if (ingredient.section === "Other") return 0;
  if (product.categoriesTags.length === 0) return -2;

  const normalizedTags = product.categoriesTags.map(normalizeText);
  return normalizedTags.every((tag) => tag.includes("undefined")) ? -2 : 0;
}

function scoreSectionBonus(ingredient: Ingredient, product: OpenPricesProduct): number {
  const hints = SECTION_CATEGORY_HINTS[ingredient.section];
  if (hints.length === 0) return 0;

  const haystacks = product.categoriesTags.map(normalizeText);
  return includesHint(haystacks, hints) ? 2 : 0;
}

function buildSearchPlanText(searchPlan: IngredientSearchPlan): string {
  return searchPlan.searchQueries.join(" / ");
}

function buildPreliminaryProductMatch(
  ingredient: Ingredient,
  product: OpenPricesProduct,
  searchPlan: IngredientSearchPlan
): PreliminaryProductMatch | null {
  const ingredientQueries = dedupeQueries([
    searchPlan.canonicalName,
    ...searchPlan.searchQueries,
    buildSearchQuery(ingredient.name),
  ]);
  const searchText = buildProductSearchText(product);

  let bestMatchedTokenCount = 0;
  let bestTokenCoverage = 0;
  let bestExactPhraseMatch = false;
  let bestNormalizedQuery = "";

  for (const ingredientQuery of ingredientQueries) {
    const ingredientTokens = tokenize(ingredientQuery);
    if (ingredientTokens.length === 0) continue;

    const matchedTokenCount = countMatchingTokens(ingredientTokens, searchText);
    if (matchedTokenCount === 0) continue;

    const tokenCoverage = matchedTokenCount / ingredientTokens.length;
    const normalizedIngredientQuery = normalizeText(ingredientQuery);
    const exactPhraseMatch = searchText.includes(normalizedIngredientQuery);

    if (
      tokenCoverage > bestTokenCoverage ||
      (tokenCoverage === bestTokenCoverage && matchedTokenCount > bestMatchedTokenCount) ||
      (tokenCoverage === bestTokenCoverage &&
        matchedTokenCount === bestMatchedTokenCount &&
        exactPhraseMatch &&
        !bestExactPhraseMatch)
    ) {
      bestMatchedTokenCount = matchedTokenCount;
      bestTokenCoverage = tokenCoverage;
      bestExactPhraseMatch = exactPhraseMatch;
      bestNormalizedQuery = normalizedIngredientQuery;
    }
  }

  if (bestMatchedTokenCount === 0) return null;

  const normalizedProductName = normalizeText(product.productName);
  const exactPhraseMatch = bestExactPhraseMatch;
  const productTokenPenalty =
    Math.max(0, tokenize(product.productName).length - bestMatchedTokenCount - 2) * 1.2;
  const sectionBonus = scoreSectionBonus(ingredient, product);

  let score =
    bestMatchedTokenCount * 4 + bestTokenCoverage * 4 - productTokenPenalty + sectionBonus;

  if (exactPhraseMatch) {
    score += 3;
  }

  if (
    bestNormalizedQuery &&
    (normalizedProductName.startsWith(bestNormalizedQuery) ||
      normalizedProductName.endsWith(bestNormalizedQuery))
  ) {
    score += 1.5;
  }

  if (product.productQuantity !== null && product.productQuantity > 0) {
    score += 1.5;
  }

  if (product.priceCount > 1) {
    score += Math.min(2, Math.log2(product.priceCount));
  }

  score += scorePreparedFoodPenalty(ingredient, product);
  score += scoreSparseCategoryPenalty(ingredient, product);

  if (score <= 0) return null;

  return {
    product,
    score,
    tokenCoverage: bestTokenCoverage,
    exactPhraseMatch,
    sectionBonus,
  };
}

function parseProductNamePackageMeasurement(productName: string): ProductPackageMeasurement | null {
  const match = normalizeText(productName).match(
    /((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\.\d+)|(?:\d+))\s*(fluid ounces?|fluid ozs?|fluid oz|fl oz|floz|ounces?|oz|pounds?|lbs?|lb|kilograms?|kg|grams?|g|milliliters?|millilitres?|ml|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal|tablespoons?|tbsp|teaspoons?|tsp)\b/
  );
  if (!match) return null;

  const amount = parseQuantity(match[1] ?? "");
  const unit = cleanText(match[2] ?? "").toLowerCase();
  if (amount === null || amount <= 0 || !unit) return null;

  return {
    amount,
    unit,
    displayText: formatPackageSize(amount, unit),
    inferredUnit: false,
  };
}

function inferProductQuantityUnit(
  product: OpenPricesProduct,
  ingredient: Ingredient,
  preferredDimension?: MeasurementDimension
): string | null {
  const unit = sanitizeOptionalText(product.productQuantityUnit);
  if (unit) {
    return unit;
  }

  if (product.productQuantity === null || product.productQuantity <= 0) {
    return null;
  }

  if (preferredDimension === "volume") return "ml";
  if (preferredDimension === "weight") return "g";

  const normalizedText = [
    normalizeText(product.productName),
    ...product.categoriesTags.map(normalizeText),
  ];

  if (includesHint(normalizedText, LIQUID_PRODUCT_HINTS)) {
    return "ml";
  }

  if (includesHint(normalizedText, WEIGHT_PRODUCT_HINTS)) {
    return "g";
  }

  if (
    ingredient.section === "Condiments & Sauces" ||
    ingredient.section === "Beverages"
  ) {
    return "ml";
  }

  if (
    ingredient.section === "Pantry & Dry Goods" ||
    ingredient.section === "Spices & Baking" ||
    ingredient.section === "Meat & Seafood"
  ) {
    return "g";
  }

  return null;
}

function buildProductPackageMeasurement(
  product: OpenPricesProduct,
  ingredient: Ingredient
): ProductPackageMeasurement | null {
  const parsedFromName = parseProductNamePackageMeasurement(product.productName);
  if (parsedFromName) {
    return parsedFromName;
  }

  if (product.productQuantity === null || product.productQuantity <= 0) {
    return null;
  }

  const preferredDimension = toMeasurement(1, ingredient.unit)?.dimension;
  const inferredUnit = inferProductQuantityUnit(product, ingredient, preferredDimension);
  if (!inferredUnit) {
    return null;
  }

  return {
    amount: product.productQuantity,
    unit: inferredUnit,
    displayText: formatPackageSize(product.productQuantity, inferredUnit),
    inferredUnit: !product.productQuantityUnit,
  };
}

function buildComparableMeasurements(
  ingredient: Ingredient,
  product: OpenPricesProduct
): ComparableMeasurements | null {
  const ingredientAmount = parseQuantity(ingredient.quantity);
  if (ingredientAmount === null || ingredientAmount <= 0) {
    return null;
  }

  const baseIngredientMeasure = toMeasurement(ingredientAmount, ingredient.unit);
  const packageMeasurement = buildProductPackageMeasurement(product, ingredient);
  if (!packageMeasurement) {
    return null;
  }

  const preferredDimension = baseIngredientMeasure?.dimension;
  const productMeasure = toMeasurement(
    packageMeasurement.amount,
    packageMeasurement.unit,
    preferredDimension
  );
  if (!productMeasure) {
    return null;
  }

  const exactIngredientMeasure =
    baseIngredientMeasure?.dimension === productMeasure.dimension
      ? baseIngredientMeasure
      : baseIngredientMeasure
        ? null
        : toMeasurement(ingredientAmount, ingredient.unit, productMeasure.dimension);

  if (exactIngredientMeasure && exactIngredientMeasure.dimension === productMeasure.dimension) {
    return {
      ingredientMeasure: exactIngredientMeasure,
      productMeasure,
      packageSizeText: packageMeasurement.displayText,
      inferredUnit: packageMeasurement.inferredUnit,
      usedApproximateDensity: false,
    };
  }

  if (!baseIngredientMeasure) {
    return null;
  }

  const densityEstimate = getDensityEstimate(ingredient);
  const densityAdjustedIngredientMeasure =
    densityEstimate === null
      ? null
      : convertMeasurementDimension(baseIngredientMeasure, productMeasure.dimension, densityEstimate);

  if (!densityAdjustedIngredientMeasure) {
    return null;
  }

  return {
    ingredientMeasure: densityAdjustedIngredientMeasure,
    productMeasure,
    packageSizeText: packageMeasurement.displayText,
    inferredUnit: packageMeasurement.inferredUnit,
    usedApproximateDensity: true,
  };
}

function getMinimumPreferredPackageBase(
  ingredient: Ingredient,
  dimension: MeasurementDimension
): number {
  if (dimension === "count") return 1;

  switch (ingredient.section) {
    case "Condiments & Sauces":
      return 100;
    case "Pantry & Dry Goods":
      return 100;
    case "Spices & Baking":
      return dimension === "weight" ? 25 : 50;
    case "Beverages":
      return 250;
    case "Dairy & Eggs":
      return 100;
    case "Produce":
    case "Meat & Seafood":
      return 100;
    default:
      return 50;
  }
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

function buildUnavailableEstimate(
  ingredient: Ingredient,
  reason: string,
  searchPlan: IngredientSearchPlan,
  match?: ScoredProductMatch
): IngredientPriceEstimate {
  const packagePrice = match?.pricing.stats.averagePrice
    ? roundToCents(match.pricing.stats.averagePrice)
    : null;
  const searchPlanText = buildSearchPlanText(searchPlan);
  const reasonWithSearch = searchPlanText ? `${reason} Searched: ${searchPlanText}.` : reason;

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice: null,
    adjustedPriceText: null,
    packagePrice,
    packagePriceText: packagePrice !== null ? formatUsd(packagePrice) : null,
    packageSizeText: match?.comparableMeasurements?.packageSizeText,
    matchTitle: match?.product.productName,
    matchStore: match?.pricing.latestPrice?.storeName,
    matchUrl: match?.product.code
      ? `https://world.openfoodfacts.org/product/${match.product.code}`
      : undefined,
    confidence: match
      ? clampConfidence(
          match.tokenCoverage * 0.45 +
            (match.sectionBonus > 0 ? 0.2 : 0) +
            (match.pricing.stats.priceCount > 1 ? 0.15 : 0.05)
        )
      : null,
    explanation: match
      ? `${match.pricing.stats.priceCount} USD price observation${
          match.pricing.stats.priceCount === 1 ? "" : "s"
        }${match.pricing.latestPrice?.storeName ? ` · Latest at ${match.pricing.latestPrice.storeName}` : ""}`
      : undefined,
    unavailableReason: reasonWithSearch,
  };
}

function buildScoredProductMatch(
  ingredient: Ingredient,
  preliminary: PreliminaryProductMatch,
  pricing: OpenPricesProductPricing
): ScoredProductMatch {
  const comparableMeasurements = buildComparableMeasurements(ingredient, preliminary.product);
  let finalScore = preliminary.score;

  if (pricing.stats.priceCount > 0 && pricing.stats.averagePrice !== null) {
    finalScore += 2;
  }

  if (comparableMeasurements) {
    finalScore += comparableMeasurements.usedApproximateDensity ? 3 : 5;
    if (comparableMeasurements.inferredUnit) {
      finalScore -= 1;
    }

    const packageToIngredientRatio =
      comparableMeasurements.ingredientMeasure.baseAmount /
      comparableMeasurements.productMeasure.baseAmount;
    const minimumPreferredPackageBase = getMinimumPreferredPackageBase(
      ingredient,
      comparableMeasurements.productMeasure.dimension
    );

    if (packageToIngredientRatio > 1) {
      finalScore -= 6;
    } else if (packageToIngredientRatio > 0.75) {
      finalScore -= 3;
    }

    if (
      comparableMeasurements.productMeasure.baseAmount < minimumPreferredPackageBase &&
      comparableMeasurements.ingredientMeasure.baseAmount < minimumPreferredPackageBase
    ) {
      finalScore -= 4;
    }

    if (
      comparableMeasurements.productMeasure.baseAmount < 30 &&
      comparableMeasurements.productMeasure.dimension !== "count"
    ) {
      finalScore -= 4;
    }
  } else {
    finalScore -= 4;
  }

  return {
    ...preliminary,
    pricing,
    comparableMeasurements,
    finalScore,
  };
}

async function estimateIngredientPrice(
  ingredient: Ingredient,
  searchPlan: IngredientSearchPlan
): Promise<IngredientPriceEstimate> {
  const products = await searchProducts(searchPlan);
  if (products.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Open Food Facts Open Prices did not return a usable grocery product for this ingredient.",
      searchPlan
    );
  }

  const preliminaryMatches = products
    .map((product) => buildPreliminaryProductMatch(ingredient, product, searchPlan))
    .filter((match): match is PreliminaryProductMatch => Boolean(match))
    .sort((left, right) => right.score - left.score)
    .slice(0, PRODUCT_PRICING_LOOKUP_LIMIT);

  if (preliminaryMatches.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Open Food Facts Open Prices did not return a confident grocery match for this ingredient.",
      searchPlan
    );
  }

  const scoredMatches = (
    await mapWithConcurrency(preliminaryMatches, PRODUCT_PRICING_LOOKUP_LIMIT, async (match) => {
      const pricing = await getProductPricing(match.product.id);
      if (!pricing) return null;
      return buildScoredProductMatch(ingredient, match, pricing);
    })
  ).filter((match): match is ScoredProductMatch => Boolean(match));

  if (scoredMatches.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Open Food Facts Open Prices did not return any recent USD price data for this ingredient.",
      searchPlan
    );
  }

  const bestMatch = scoredMatches.sort((left, right) => right.finalScore - left.finalScore)[0];

  if (bestMatch.finalScore < 10 || (bestMatch.tokenCoverage < 0.5 && !bestMatch.exactPhraseMatch)) {
    return buildUnavailableEstimate(
      ingredient,
      "Open Food Facts Open Prices did not return a confident grocery match for this ingredient.",
      searchPlan,
      bestMatch
    );
  }

  const packagePrice = roundToCents(bestMatch.pricing.stats.averagePrice ?? 0);
  if (!bestMatch.comparableMeasurements) {
    return buildUnavailableEstimate(
      ingredient,
      "Open Food Facts found a product, but its package size could not be converted to this recipe quantity automatically.",
      searchPlan,
      bestMatch
    );
  }

  const adjustedPrice = roundToCents(
    packagePrice *
      (bestMatch.comparableMeasurements.ingredientMeasure.baseAmount /
        bestMatch.comparableMeasurements.productMeasure.baseAmount)
  );

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice,
    adjustedPriceText: formatUsd(adjustedPrice),
    packagePrice,
    packagePriceText: formatUsd(packagePrice),
    packageSizeText: bestMatch.comparableMeasurements.packageSizeText,
    matchTitle: bestMatch.product.productName,
    matchStore: bestMatch.pricing.latestPrice?.storeName,
    matchUrl: bestMatch.product.code
      ? `https://world.openfoodfacts.org/product/${bestMatch.product.code}`
      : undefined,
    confidence: clampConfidence(
      bestMatch.tokenCoverage * 0.45 +
        (bestMatch.exactPhraseMatch ? 0.2 : 0) +
        (bestMatch.sectionBonus > 0 ? 0.15 : 0) +
        (bestMatch.comparableMeasurements.usedApproximateDensity ? 0.08 : 0.16) +
        (bestMatch.comparableMeasurements.inferredUnit ? 0.04 : 0.08)
    ),
    explanation: `${bestMatch.pricing.stats.priceCount} USD price observation${
      bestMatch.pricing.stats.priceCount === 1 ? "" : "s"
    }${bestMatch.pricing.latestPrice?.storeName ? ` · Latest at ${bestMatch.pricing.latestPrice.storeName}` : ""}`,
    unavailableReason: null,
  };
}

export async function estimateRecipeWithOpenFoodFacts(
  input: unknown
): Promise<RecipePriceEstimate> {
  const body = (input ?? {}) as RecipePricingRequest;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(isIngredient) : [];

  if (ingredients.length === 0) {
    return {
      provider: "open-food-facts",
      estimatedAt: new Date().toISOString(),
      currencyCode: "USD",
      totalAdjustedPrice: 0,
      totalAdjustedPriceText: formatUsd(0),
      resolvedIngredientCount: 0,
      unresolvedIngredientCount: 0,
      ingredients: [],
    };
  }

  const searchPlans = await buildIngredientSearchPlans(ingredients);
  const estimates = await mapWithConcurrency(ingredients, 4, (ingredient) =>
    estimateIngredientPrice(
      ingredient,
      searchPlans.get(ingredient.id) ?? buildHeuristicSearchPlan(ingredient)
    )
  );

  const totalAdjustedPrice = roundToCents(
    estimates.reduce((sum, estimate) => sum + (estimate.adjustedPrice ?? 0), 0)
  );
  const resolvedIngredientCount = estimates.filter(
    (estimate) => estimate.adjustedPrice !== null
  ).length;

  return {
    provider: "open-food-facts",
    estimatedAt: new Date().toISOString(),
    currencyCode: "USD",
    totalAdjustedPrice,
    totalAdjustedPriceText: formatUsd(totalAdjustedPrice),
    resolvedIngredientCount,
    unresolvedIngredientCount: estimates.length - resolvedIngredientCount,
    ingredients: estimates,
  };
}
