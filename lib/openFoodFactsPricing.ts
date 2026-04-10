import Anthropic from "@anthropic-ai/sdk";
import {
  IngredientPriceEstimate,
  RecipePriceEstimate,
  RecipePricingRequest,
} from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";
import { convertIngredientQuantity, type ExactUnit } from "@/lib/unitConversion";
import { estimateProduceIngredientPrice } from "@/lib/usdaProducePricing";

const OPEN_PRICES_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const WALMART_SEARCH_BASE_URL = "https://www.walmart.com/search";
const WALMART_ORIGIN = "https://www.walmart.com";
const WALMART_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
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

const WEIGHT_PREFERRED_NAME_PATTERNS = [
  /\b(chili crisp|chilli crisp|gochujang|miso|mole paste|paste|pesto|purée|puree|sambal|spread|tahini|tomato paste)\b/i,
  /\b(peanut butter|almond butter|sunflower butter|cream cheese|jam|jelly|hummus|nut butter)\b/i,
] as const;

const VOLUME_PREFERRED_NAME_PATTERNS = [
  /\b(broth|stock|juice|milk|oil|soy sauce|tamari|vinegar|water|wine)\b/i,
  /\b(extract|syrup|hot sauce|fish sauce|worcestershire|dressing)\b/i,
] as const;

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
  "pk",
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
  { pattern: /\b(chili crisp|chilli crisp)\b/i, gramsPerMilliliter: 0.92 },
  { pattern: /\b(gochujang|korean chili paste|red pepper paste)\b/i, gramsPerMilliliter: 1.2 },
  { pattern: /\b(tomato purée|tomato puree|tomato paste)\b/i, gramsPerMilliliter: 1.15 },
  { pattern: /\b(miso|tahini)\b/i, gramsPerMilliliter: 1.2 },
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
  packagePrice: number | null;
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

interface ResolvedIngredientMeasurement {
  measurement: Measurement;
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
  pricingUnit: StandardPricingUnit;
  pricingQuantity: number | null;
}

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

function sanitizePricingUnit(value: unknown): StandardPricingUnit | null {
  if (value === "count" || value === "g" || value === "ml") {
    return value;
  }

  return null;
}

function inferHeuristicPricingUnit(ingredient: Ingredient): StandardPricingUnit {
  const normalizedName = normalizeText(ingredient.name);
  const normalizedUnit = normalizeUnitKey(ingredient.unit);

  if (COUNT_UNITS.has(normalizedUnit)) {
    return "count";
  }

  if (ingredient.section === "Beverages") {
    return "ml";
  }

  if (WEIGHT_PREFERRED_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return "g";
  }

  if (VOLUME_PREFERRED_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    return "ml";
  }

  if (ingredient.section === "Condiments & Sauces") {
    return /\b(oil|sauce|vinegar|dressing)\b/i.test(normalizedName) ? "ml" : "g";
  }

  if (ingredient.section === "Spices & Baking") {
    return /\b(extract|food coloring|oil)\b/i.test(normalizedName) ? "ml" : "g";
  }

  const exactMeasure = toMeasurement(1, ingredient.unit);
  if (exactMeasure?.dimension === "volume") {
    return "ml";
  }

  if (exactMeasure?.dimension === "weight") {
    return "g";
  }

  return "g";
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
    pricingUnit: inferHeuristicPricingUnit(ingredient),
    pricingQuantity: null,
  };
}

function getIngredientSearchPlanCacheKey(ingredients: Ingredient[]): string {
  return ingredients
    .map((ingredient) =>
      [
        ingredient.id,
        normalizeSearchTerm(ingredient.name),
        normalizeSearchTerm(ingredient.quantity),
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
      pricingUnit?: unknown;
      pricingQuantity?: unknown;
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
    const pricingUnit = sanitizePricingUnit(entry.pricingUnit);
    const pricingQuantity = sanitizeOptionalNumber(entry.pricingQuantity);

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
      pricingUnit: pricingUnit ?? "g",
      pricingQuantity:
        pricingQuantity !== null && pricingQuantity > 0 ? pricingQuantity : null,
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
          content: `Turn these recipe ingredients into grocery search plans for Walmart grocery search results.

Each ingredient needs:
- canonicalName: the short, generic grocery item name
- searchQueries: 2 to 4 short search phrases, ordered best to fallback
- pricingUnit: choose exactly one of "g", "ml", or "count"
- pricingQuantity: convert the recipe amount into that pricingUnit and return a number, or null if no sensible conversion is possible

Rules:
- Remove prep notes, garnish notes, and cooking instructions.
- Keep the actual grocery item identity.
- Prefer the most likely specific product if the ingredient suggests one in parentheses.
- Use lowercase only.
- Queries must be short grocery phrases, not sentences.
- Do not include quantities, units, brand names, or packaging sizes.
- Use search phrases that are likely to return normal US grocery products on Walmart.
- Package sizes on Walmart may be count-based or use US customary units. Focus the query on the grocery item identity, not the package size.
- Use:
  - "ml" for liquids like oils, milks, broths, juices, vinegars, and pourable sauces
  - "g" for solids, powders, spices, pastes, spreads, purées, and thick condiments
  - "count" for discrete produce or packaged items usually bought by piece, bunch, bulb, can, jar, or package
- Convert the recipe quantity into that pricingUnit.
- pricingQuantity must be numeric only, with no unit suffix.
- If the recipe quantity is a range, use the midpoint.
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
      "searchQueries": ["best query", "fallback query"],
      "pricingUnit": "g",
      "pricingQuantity": 30
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
      pricingUnit: aiPlan.pricingUnit ?? heuristicPlan.pricingUnit,
      pricingQuantity:
        aiPlan.pricingQuantity !== null && aiPlan.pricingQuantity > 0
          ? aiPlan.pricingQuantity
          : heuristicPlan.pricingQuantity,
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

function getPricingUnitDimension(pricingUnit: StandardPricingUnit): MeasurementDimension {
  switch (pricingUnit) {
    case "count":
      return "count";
    case "ml":
      return "volume";
    default:
      return "weight";
  }
}

function getPricingUnitExactUnit(pricingUnit: StandardPricingUnit): ExactUnit | null {
  if (pricingUnit === "count") {
    return null;
  }

  return pricingUnit;
}

function getDensityEstimateForName(name: string, section: Ingredient["section"]): number | null {
  const normalizedName = cleanText(name).toLowerCase();

  for (const override of DENSITY_OVERRIDES) {
    if (override.pattern.test(normalizedName)) {
      return override.gramsPerMilliliter;
    }
  }

  if (section === "Spices & Baking") {
    if (/\b(dried|leaf|flakes?|herb)\b/i.test(normalizedName)) {
      return 0.16;
    }

    return 0.4;
  }

  return null;
}

function getDensityEstimate(
  ingredient: Ingredient,
  searchPlan?: IngredientSearchPlan
): number | null {
  const names = dedupeQueries([
    ingredient.name,
    searchPlan?.canonicalName ?? "",
    ...(searchPlan?.searchQueries ?? []),
  ]);

  for (const name of names) {
    const estimate = getDensityEstimateForName(name, ingredient.section);
    if (estimate !== null) {
      return estimate;
    }
  }

  return null;
}

async function convertIngredientToTargetUnit(
  ingredient: Ingredient,
  searchPlan: IngredientSearchPlan,
  targetUnit: ExactUnit
): Promise<ResolvedIngredientMeasurement | null> {
  const candidateNames = dedupeQueries([
    searchPlan.canonicalName,
    ...searchPlan.searchQueries,
    ingredient.name,
  ]);

  for (const ingredientName of candidateNames) {
    try {
      const converted = await convertIngredientQuantity({
        ingredientName,
        quantity: ingredient.quantity,
        fromUnit: ingredient.unit,
        toUnit: targetUnit,
      });
      const measurement = toMeasurement(converted.averageValue, converted.toUnit);
      if (measurement) {
        return {
          measurement,
          usedApproximateDensity: Boolean(converted.source),
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveIngredientMeasurement(
  ingredient: Ingredient,
  searchPlan: IngredientSearchPlan,
  targetDimension: MeasurementDimension
): Promise<ResolvedIngredientMeasurement | null> {
  const ingredientAmount = parseQuantity(ingredient.quantity);
  if (ingredientAmount === null || ingredientAmount <= 0) {
    return null;
  }

  const baseIngredientMeasure = toMeasurement(ingredientAmount, ingredient.unit, targetDimension);
  if (baseIngredientMeasure?.dimension === targetDimension) {
    return {
      measurement: baseIngredientMeasure,
      usedApproximateDensity: false,
    };
  }

  const candidateUnits: ExactUnit[] = [];
  const preferredExactUnit = getPricingUnitExactUnit(searchPlan.pricingUnit);
  if (
    preferredExactUnit &&
    getPricingUnitDimension(searchPlan.pricingUnit) === targetDimension
  ) {
    candidateUnits.push(preferredExactUnit);
  }

  if (targetDimension === "weight") {
    candidateUnits.push("g");
  } else if (targetDimension === "volume") {
    candidateUnits.push("ml");
  }

  for (const targetUnit of [...new Set(candidateUnits)]) {
    const converted = await convertIngredientToTargetUnit(ingredient, searchPlan, targetUnit);
    if (converted?.measurement.dimension === targetDimension) {
      return converted;
    }
  }

  if (
    searchPlan.pricingQuantity !== null &&
    searchPlan.pricingQuantity > 0 &&
    getPricingUnitDimension(searchPlan.pricingUnit) === targetDimension
  ) {
    const aiMeasurement = toMeasurement(searchPlan.pricingQuantity, searchPlan.pricingUnit);
    if (aiMeasurement) {
      return {
        measurement: aiMeasurement,
        usedApproximateDensity: true,
      };
    }
  }

  if (!baseIngredientMeasure) {
    return null;
  }

  const densityEstimate = getDensityEstimate(ingredient, searchPlan);
  const densityAdjustedIngredientMeasure =
    densityEstimate === null
      ? null
      : convertMeasurementDimension(baseIngredientMeasure, targetDimension, densityEstimate);

  if (!densityAdjustedIngredientMeasure) {
    return null;
  }

  return {
    measurement: densityAdjustedIngredientMeasure,
    usedApproximateDensity: true,
  };
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

function buildStoreProductUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return /^https?:\/\//i.test(path) ? path : `${WALMART_ORIGIN}${path}`;
}

function parseUsdPriceText(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? roundToCents(value) : null;
  }

  if (typeof value !== "string") return null;

  const normalized = cleanText(value).replace(/,/g, "");
  if (!normalized) return null;

  const centsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*¢/);
  if (centsMatch) {
    const parsed = Number(centsMatch[1]);
    return Number.isFinite(parsed) && parsed > 0 ? roundToCents(parsed / 100) : null;
  }

  const dollarsMatch = normalized.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!dollarsMatch) return null;

  const parsed = Number(dollarsMatch[1]);
  return Number.isFinite(parsed) && parsed > 0 ? roundToCents(parsed) : null;
}

function parseProduct(input: unknown): OpenPricesProduct | null {
  if (!input || typeof input !== "object") return null;

  const candidate = input as Record<string, unknown>;
  const id = sanitizeOptionalInteger(candidate.usItemId) ?? sanitizeOptionalInteger(candidate.id);
  const productName = sanitizeOptionalText(candidate.name);
  const priceInfo =
    candidate.priceInfo && typeof candidate.priceInfo === "object"
      ? (candidate.priceInfo as Record<string, unknown>)
      : undefined;
  const packagePrice =
    sanitizeOptionalNumber(candidate.price) ??
    parseUsdPriceText(priceInfo?.linePriceDisplay) ??
    parseUsdPriceText(priceInfo?.linePrice) ??
    parseUsdPriceText(priceInfo?.itemPrice);

  if (id === null || id <= 0 || !productName || packagePrice === null || packagePrice <= 0) {
    return null;
  }

  const parsedPackage = parseProductNamePackageMeasurement(productName);
  const categoriesTags = dedupeQueries([
    sanitizeOptionalText(candidate.catalogProductType) ?? "",
    sanitizeOptionalText(candidate.salesUnitType) ?? "",
  ]);

  return {
    id,
    code: sanitizeOptionalText(candidate.canonicalUrl),
    productName,
    productQuantity: parsedPackage?.amount ?? null,
    productQuantityUnit: parsedPackage?.unit,
    categoriesTags,
    brands:
      sanitizeOptionalText(candidate.brand) ??
      sanitizeOptionalText(candidate.manufacturerName),
    priceCount: 1,
    packagePrice,
  };
}

function extractWalmartResultItems(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  const props =
    root.props && typeof root.props === "object"
      ? (root.props as Record<string, unknown>)
      : undefined;
  const pageProps =
    props?.pageProps && typeof props.pageProps === "object"
      ? (props.pageProps as Record<string, unknown>)
      : undefined;
  const initialData =
    pageProps?.initialData && typeof pageProps.initialData === "object"
      ? (pageProps.initialData as Record<string, unknown>)
      : undefined;
  const searchResult =
    initialData?.searchResult && typeof initialData.searchResult === "object"
      ? (initialData.searchResult as Record<string, unknown>)
      : undefined;
  const itemStacks = Array.isArray(searchResult?.itemStacks)
    ? (searchResult.itemStacks as unknown[])
    : [];

  let fallbackItems: unknown[] = [];

  for (const stack of itemStacks) {
    if (!stack || typeof stack !== "object") continue;

    const candidate = stack as Record<string, unknown>;
    const meta =
      candidate.meta && typeof candidate.meta === "object"
        ? (candidate.meta as Record<string, unknown>)
        : undefined;
    const items = Array.isArray(candidate.items)
      ? (candidate.items as unknown[])
      : Array.isArray(candidate.itemsV2)
        ? (candidate.itemsV2 as unknown[])
        : [];

    if (items.length === 0) continue;

    if (fallbackItems.length === 0) {
      fallbackItems = items;
    }

    if (meta?.isSponsored === true) continue;
    if (sanitizeOptionalText(meta?.stackType) === "STORE_LED") {
      return items;
    }
  }

  return fallbackItems;
}

function parseProductList(payload: unknown): OpenPricesProduct[] {
  const items = extractWalmartResultItems(payload);

  return items
    .map(parseProduct)
    .filter((product): product is OpenPricesProduct => Boolean(product))
    .slice(0, PRODUCT_SEARCH_LIMIT);
}

function buildInlinePricing(product: OpenPricesProduct): OpenPricesProductPricing | null {
  if (product.packagePrice === null || product.packagePrice <= 0) {
    return null;
  }

  return {
    stats: {
      priceCount: 1,
      minimumPrice: product.packagePrice,
      maximumPrice: product.packagePrice,
      averagePrice: product.packagePrice,
    },
    latestPrice: {
      price: product.packagePrice,
      currency: "USD",
      storeName: "Walmart",
      countryCode: "US",
    },
  };
}

function extractWalmartSearchPayload(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new PricingRouteError(
      "Walmart search results could not be parsed for pricing data.",
      502
    );
  }

  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    throw new PricingRouteError(
      "Walmart search results returned malformed pricing data.",
      502
    );
  }
}

async function fetchWalmartSearchPayload(query: string): Promise<unknown> {
  const searchParams = new URLSearchParams({
    q: query,
  });

  const response = await fetch(`${WALMART_SEARCH_BASE_URL}?${searchParams.toString()}`, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": WALMART_USER_AGENT,
    },
    cache: "no-store",
  });

  const payload = await response.text();

  if (!response.ok) {
    throw new PricingRouteError(
      `Walmart search request failed with status ${response.status}.`,
      response.status >= 500 ? 502 : response.status
    );
  }

  return extractWalmartSearchPayload(payload);
}

async function searchProductsForQuery(query: string): Promise<OpenPricesProduct[]> {
  const normalizedQuery = normalizeSearchTerm(query);

  return getCachedPromise(productSearchCache, normalizedQuery, async () => {
    const payload = await fetchWalmartSearchPayload(normalizedQuery);
    const products = parseProductList(payload);
    const expiresAt = Date.now() + OPEN_PRICES_CACHE_TTL_MS;

    for (const product of products) {
      const pricing = buildInlinePricing(product);
      if (!pricing) continue;

      productPricingCache.set(product.id, {
        expiresAt,
        value: Promise.resolve(pricing),
      });
    }

    return products;
  });
}

async function searchProducts(searchPlan: IngredientSearchPlan): Promise<OpenPricesProduct[]> {
  const results = await mapWithConcurrency(
    searchPlan.searchQueries.slice(0, SEARCH_QUERY_LIMIT),
    2,
    async (query) => {
      try {
        return await searchProductsForQuery(query);
      } catch (error) {
        console.error(`Walmart search failed for query "${query}":`, error);
        return [];
      }
    }
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
  const cached = productPricingCache.get(productId);
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }

  return cached.value;
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
    /((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d*\.\d+)|(?:\d+))\s*(count|ct|each|ea|piece|pieces|pack|packs|pk|bunch|bunches|bulb|bulbs|head|heads|fluid ounces?|fluid ozs?|fluid oz|fl oz|floz|ounces?|oz|pounds?|lbs?|lb|kilograms?|kg|grams?|g|milliliters?|millilitres?|ml|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal|tablespoons?|tbsp|teaspoons?|tsp)\b/
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
  searchPlan: IngredientSearchPlan,
  preferredDimension?: MeasurementDimension
): string | null {
  const unit = sanitizeOptionalText(product.productQuantityUnit);
  if (unit) {
    return unit;
  }

  if (product.productQuantity === null || product.productQuantity <= 0) {
    return null;
  }

  if (searchPlan.pricingUnit === "count") return "count";
  if (searchPlan.pricingUnit === "ml") return "ml";
  if (searchPlan.pricingUnit === "g") return "g";

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
  ingredient: Ingredient,
  searchPlan: IngredientSearchPlan
): ProductPackageMeasurement | null {
  const parsedFromName = parseProductNamePackageMeasurement(product.productName);
  if (parsedFromName) {
    return parsedFromName;
  }

  if (product.productQuantity === null || product.productQuantity <= 0) {
    return null;
  }

  const preferredDimension =
    getPricingUnitDimension(searchPlan.pricingUnit) ?? toMeasurement(1, ingredient.unit)?.dimension;
  const inferredUnit = inferProductQuantityUnit(
    product,
    ingredient,
    searchPlan,
    preferredDimension
  );
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

async function buildComparableMeasurements(
  ingredient: Ingredient,
  product: OpenPricesProduct,
  searchPlan: IngredientSearchPlan
): Promise<ComparableMeasurements | null> {
  const preferredDimension = getPricingUnitDimension(searchPlan.pricingUnit);
  const packageMeasurement = buildProductPackageMeasurement(product, ingredient, searchPlan);
  if (!packageMeasurement) {
    return null;
  }

  const productMeasure = toMeasurement(
    packageMeasurement.amount,
    packageMeasurement.unit,
    preferredDimension
  );
  if (!productMeasure) {
    return null;
  }

  const resolvedIngredientMeasure = await resolveIngredientMeasurement(
    ingredient,
    searchPlan,
    productMeasure.dimension
  );
  if (!resolvedIngredientMeasure) {
    return null;
  }

  return {
    ingredientMeasure: resolvedIngredientMeasure.measurement,
    productMeasure,
    packageSizeText: packageMeasurement.displayText,
    inferredUnit: packageMeasurement.inferredUnit,
    usedApproximateDensity: resolvedIngredientMeasure.usedApproximateDensity,
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
    matchUrl: buildStoreProductUrl(match?.product.code),
    confidence: match
      ? clampConfidence(
          match.tokenCoverage * 0.45 +
            (match.sectionBonus > 0 ? 0.2 : 0) +
            (match.pricing.latestPrice ? 0.1 : 0)
        )
      : null,
    explanation: match
      ? `${match.pricing.latestPrice?.storeName ?? "Walmart"} search result price captured at lookup time`
      : undefined,
    unavailableReason: reasonWithSearch,
  };
}

async function buildScoredProductMatch(
  ingredient: Ingredient,
  preliminary: PreliminaryProductMatch,
  pricing: OpenPricesProductPricing,
  searchPlan: IngredientSearchPlan
): Promise<ScoredProductMatch> {
  const comparableMeasurements = await buildComparableMeasurements(
    ingredient,
    preliminary.product,
    searchPlan
  );
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
  const usdaProduceEstimate = await estimateProduceIngredientPrice(ingredient, searchPlan);
  if (usdaProduceEstimate) {
    return usdaProduceEstimate;
  }

  const products = await searchProducts(searchPlan);
  if (products.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Walmart search did not return a usable grocery product for this ingredient.",
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
      "Walmart search did not return a confident grocery match for this ingredient.",
      searchPlan
    );
  }

  const scoredMatches = (
    await mapWithConcurrency(preliminaryMatches, PRODUCT_PRICING_LOOKUP_LIMIT, async (match) => {
      const pricing = await getProductPricing(match.product.id);
      if (!pricing) return null;
      return buildScoredProductMatch(ingredient, match, pricing, searchPlan);
    })
  ).filter((match): match is ScoredProductMatch => Boolean(match));

  if (scoredMatches.length === 0) {
    return buildUnavailableEstimate(
      ingredient,
      "Walmart search did not return a priced grocery result for this ingredient.",
      searchPlan
    );
  }

  const bestMatch = scoredMatches.sort((left, right) => right.finalScore - left.finalScore)[0];

  if (bestMatch.finalScore < 10 || (bestMatch.tokenCoverage < 0.5 && !bestMatch.exactPhraseMatch)) {
    return buildUnavailableEstimate(
      ingredient,
      "Walmart search did not return a confident grocery match for this ingredient.",
      searchPlan,
      bestMatch
    );
  }

  const packagePrice = roundToCents(bestMatch.pricing.stats.averagePrice ?? 0);
  if (!bestMatch.comparableMeasurements) {
    return buildUnavailableEstimate(
      ingredient,
      "Walmart returned a product, but its package size could not be converted to this recipe quantity automatically.",
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
    matchUrl: buildStoreProductUrl(bestMatch.product.code),
    confidence: clampConfidence(
      bestMatch.tokenCoverage * 0.45 +
        (bestMatch.exactPhraseMatch ? 0.2 : 0) +
        (bestMatch.sectionBonus > 0 ? 0.15 : 0) +
        (bestMatch.comparableMeasurements.usedApproximateDensity ? 0.08 : 0.16) +
        (bestMatch.comparableMeasurements.inferredUnit ? 0.04 : 0.08)
    ),
    explanation: `${bestMatch.pricing.latestPrice?.storeName ?? "Walmart"} search result price captured at lookup time`,
    unavailableReason: null,
  };
}

export async function estimateRecipeWithWalmartSearch(
  input: unknown
): Promise<RecipePriceEstimate> {
  const body = (input ?? {}) as RecipePricingRequest;
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(isIngredient) : [];

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
