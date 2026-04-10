import { normalizeQuantityText } from "@/lib/recipeSteps";

type ExactUnitCategory = "mass" | "volume";

export type ExactUnit = keyof typeof EXACT_UNIT_FACTORS;

interface USDAFoodPortion {
  amount?: number | null;
  gramWeight?: number | null;
  modifier?: string | null;
  portionDescription?: string | null;
  measureUnit?: {
    name?: string | null;
    abbreviation?: string | null;
  } | null;
}

interface USDAFoodDetails {
  fdcId: number;
  description: string;
  dataType: string;
  foodPortions?: USDAFoodPortion[];
}

interface USDASearchFood {
  fdcId: number;
  description: string;
  dataType: string;
  score?: number;
  commonNames?: string;
  additionalDescriptions?: string;
}

interface USDASearchResponse {
  foods?: USDASearchFood[];
}

interface USDADensityMatch {
  gramsPerMilliliter: number;
  fdcId: number;
  description: string;
  dataType: string;
  portionLabel: string;
  score: number;
}

export interface QuantityExpression {
  values: number[];
  isRange: boolean;
}

export interface UnitConversionSource {
  provider: "USDA FoodData Central";
  dataType: string;
  fdcId: number;
  description: string;
  portion: string;
}

export interface ConvertedIngredientQuantity {
  convertedQuantity: string;
  convertedValues: number[];
  averageValue: number;
  fromUnit: string;
  toUnit: ExactUnit;
  source?: UnitConversionSource;
}

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
const USDA_DATA_TYPES = ["Foundation", "SR Legacy"] as const;
const USDA_SEARCH_RESULT_LIMIT = 6;
const USDA_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const EXACT_UNIT_FACTORS = {
  cup: { category: "volume" as ExactUnitCategory, factor: 236.5882365 },
  tbsp: { category: "volume" as ExactUnitCategory, factor: 14.78676478125 },
  tsp: { category: "volume" as ExactUnitCategory, factor: 4.92892159375 },
  "fl oz": { category: "volume" as ExactUnitCategory, factor: 29.5735295625 },
  ml: { category: "volume" as ExactUnitCategory, factor: 1 },
  l: { category: "volume" as ExactUnitCategory, factor: 1000 },
  pint: { category: "volume" as ExactUnitCategory, factor: 473.176473 },
  quart: { category: "volume" as ExactUnitCategory, factor: 946.352946 },
  gallon: { category: "volume" as ExactUnitCategory, factor: 3785.411784 },
  g: { category: "mass" as ExactUnitCategory, factor: 1 },
  kg: { category: "mass" as ExactUnitCategory, factor: 1000 },
  oz: { category: "mass" as ExactUnitCategory, factor: 28.349523125 },
  lb: { category: "mass" as ExactUnitCategory, factor: 453.59237 },
} as const;

const UNIT_ALIASES: Record<string, ExactUnit> = {
  cup: "cup",
  cups: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  tbl: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  "fl oz": "fl oz",
  floz: "fl oz",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  "fluid oz": "fl oz",
  "fluid ozs": "fl oz",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  pint: "pint",
  pints: "pint",
  pt: "pint",
  quart: "quart",
  quarts: "quart",
  qt: "quart",
  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon",
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
};

const UNIT_TEXT_PATTERNS: Array<{ unit: ExactUnit; pattern: RegExp }> = [
  { unit: "fl oz", pattern: /\b(fluid ounces?|fluid ozs?|fluid oz|fl oz|floz)\b/i },
  { unit: "tbsp", pattern: /\b(tablespoons?|table spoon|tbsp|tbl)\b/i },
  { unit: "tsp", pattern: /\b(teaspoons?|tea spoon|tsp)\b/i },
  { unit: "cup", pattern: /\bcups?\b/i },
  { unit: "ml", pattern: /\b(milliliters?|millilitres?|ml)\b/i },
  { unit: "l", pattern: /\b(liters?|litres?|l)\b/i },
  { unit: "pint", pattern: /\b(pints?|pt)\b/i },
  { unit: "quart", pattern: /\b(quarts?|qt)\b/i },
  { unit: "gallon", pattern: /\b(gallons?|gal)\b/i },
  { unit: "kg", pattern: /\b(kilograms?|kg)\b/i },
  { unit: "g", pattern: /\b(grams?|g)\b/i },
  { unit: "lb", pattern: /\b(pounds?|lbs?|lb)\b/i },
  { unit: "oz", pattern: /\b(ounces?|oz)\b/i },
];

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "fresh",
  "garnish",
  "large",
  "medium",
  "optional",
  "or",
  "small",
  "taste",
  "to",
]);

const DENSITY_DESCRIPTOR_WORDS = [
  "chopped",
  "crushed",
  "diced",
  "drained",
  "dry",
  "grated",
  "ground",
  "melted",
  "minced",
  "packed",
  "raw",
  "roasted",
  "shredded",
  "sifted",
  "sliced",
] as const;

const searchCache = new Map<
  string,
  { expiresAt: number; value: Promise<USDASearchFood[]> }
>();
const detailCache = new Map<
  number,
  { expiresAt: number; value: Promise<USDAFoodDetails> }
>();

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
    expiresAt: now + USDA_CACHE_TTL_MS,
    value,
  });

  return value;
}

export function normalizeExactUnit(value: string): ExactUnit | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");

  return UNIT_ALIASES[normalized] ?? null;
}

function parseSingleQuantityValue(value: string): number | null {
  const normalized = normalizeQuantityText(value).replace(/,/g, "");
  if (!normalized) return null;

  const mixedFraction = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/
  );
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (!Number.isFinite(whole) || denominator === 0) return null;
    const fraction = numerator / denominator;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * fraction;
  }

  const fraction = normalized.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }

  if (/^-?\d*\.?\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function parseQuantityExpression(value: string): QuantityExpression | null {
  const normalized = normalizeQuantityText(value).replace(/,/g, "");
  if (!normalized) return null;

  const range = normalized.match(/^(.+?)\s*(?:-|to)\s*(.+)$/i);
  if (range) {
    const start = parseSingleQuantityValue(range[1]);
    const end = parseSingleQuantityValue(range[2]);
    if (start === null || end === null) return null;
    return { values: [start, end], isRange: true };
  }

  const parsed = parseSingleQuantityValue(normalized);
  if (parsed === null) return null;
  return { values: [parsed], isRange: false };
}

function formatConvertedQuantity(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded
    .toString()
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatConvertedExpression(values: number[], isRange: boolean): string {
  if (!isRange || values.length === 1) {
    return formatConvertedQuantity(values[0] ?? 0);
  }

  return `${formatConvertedQuantity(values[0] ?? 0)}-${formatConvertedQuantity(
    values[1] ?? 0
  )}`;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.endsWith("ses") || word.endsWith("ss")) {
    return word;
  }

  if (word.endsWith("s") && word.length > 3) {
    return word.slice(0, -1);
  }

  return word;
}

function tokenizeIngredient(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => singularize(word));
}

function buildUsdaSearchQueries(ingredientName: string): string[] {
  const words = tokenizeIngredient(ingredientName);
  if (words.length === 0) return [];

  const original = words.join(" ");
  const simplified = words.filter((word) => !SEARCH_STOP_WORDS.has(word)).join(" ");

  return [...new Set([original, simplified].filter(Boolean))];
}

function extractUnitFromText(value: string): ExactUnit | null {
  const normalized = value
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const candidate of UNIT_TEXT_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.unit;
    }
  }

  return null;
}

function parseLeadingAmount(value: string): number | null {
  const normalized = normalizeQuantityText(value);
  const match = normalized.match(/^([0-9./\s-]+)\s+[a-z]/i);
  if (!match) return null;
  return parseSingleQuantityValue(match[1]);
}

function buildPortionLabel(portion: USDAFoodPortion): string {
  return [
    portion.amount ? formatConvertedQuantity(portion.amount) : "",
    portion.measureUnit?.abbreviation || portion.measureUnit?.name || "",
    portion.modifier || "",
    portion.portionDescription || "",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePortionVolumeUnit(
  portion: USDAFoodPortion
): { unit: ExactUnit; amount: number; label: string } | null {
  const amount =
    typeof portion.amount === "number" && Number.isFinite(portion.amount) && portion.amount > 0
      ? portion.amount
      : null;
  const texts = [
    portion.measureUnit?.abbreviation,
    portion.measureUnit?.name,
    portion.modifier,
    portion.portionDescription,
  ].filter((value): value is string => Boolean(value));

  const label = buildPortionLabel(portion);

  for (const text of texts) {
    const directUnit = normalizeExactUnit(text);
    const extractedUnit = directUnit ?? extractUnitFromText(text);
    if (!extractedUnit) continue;

    const metadata = EXACT_UNIT_FACTORS[extractedUnit];
    if (metadata.category !== "volume") continue;

    return {
      unit: extractedUnit,
      amount: amount ?? parseLeadingAmount(text) ?? 1,
      label,
    };
  }

  return null;
}

function scoreFoodCandidate(food: USDASearchFood, ingredientName: string): number {
  const ingredientTokens = tokenizeIngredient(ingredientName);
  const foodText = tokenizeIngredient(
    `${food.description} ${food.commonNames ?? ""} ${food.additionalDescriptions ?? ""}`
  );
  const foodTokenSet = new Set(foodText);

  let score = food.score ?? 0;
  let matchedWords = 0;

  for (const token of ingredientTokens) {
    if (foodTokenSet.has(token)) {
      matchedWords += 1;
      score += 40;
    } else if (food.description.toLowerCase().includes(token)) {
      score += 15;
    } else {
      score -= 8;
    }
  }

  if (food.dataType === "SR Legacy") {
    score += 10;
  }

  if (matchedWords === ingredientTokens.length) {
    score += 25;
  }

  return score;
}

function scorePortionCandidate(
  portionLabel: string,
  ingredientName: string,
  portionUnit: ExactUnit,
  preferredVolumeUnit: ExactUnit | null
): number {
  const normalizedPortion = normalizeSearchText(portionLabel);
  const normalizedIngredient = normalizeSearchText(ingredientName);

  let score = 100;

  if (preferredVolumeUnit && portionUnit === preferredVolumeUnit) {
    score += 40;
  }

  for (const descriptor of DENSITY_DESCRIPTOR_WORDS) {
    const ingredientHasDescriptor = normalizedIngredient.includes(descriptor);
    const portionHasDescriptor = normalizedPortion.includes(descriptor);

    if (ingredientHasDescriptor && portionHasDescriptor) {
      score += 20;
    } else if (ingredientHasDescriptor && !portionHasDescriptor) {
      score -= 12;
    }
  }

  if (normalizedPortion.includes("not packed") && normalizedIngredient.includes("packed")) {
    score -= 25;
  }

  return score;
}

async function searchUsdaFoods(query: string, apiKey: string): Promise<USDASearchFood[]> {
  return getCachedPromise(searchCache, query, async () => {
    const response = await fetch(
      `${USDA_API_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          dataType: USDA_DATA_TYPES,
          pageSize: USDA_SEARCH_RESULT_LIMIT,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`USDA search failed with status ${response.status}`);
    }

    const data = (await response.json()) as USDASearchResponse;
    return data.foods ?? [];
  });
}

async function fetchUsdaFoodDetails(fdcId: number, apiKey: string): Promise<USDAFoodDetails> {
  return getCachedPromise(detailCache, fdcId, async () => {
    const response = await fetch(
      `${USDA_API_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`
    );

    if (!response.ok) {
      throw new Error(`USDA food lookup failed with status ${response.status}`);
    }

    return (await response.json()) as USDAFoodDetails;
  });
}

async function findUsdaDensityMatch(
  ingredientName: string,
  preferredVolumeUnit: ExactUnit | null,
  apiKey: string
): Promise<USDADensityMatch | null> {
  const queries = buildUsdaSearchQueries(ingredientName);
  let bestMatch: USDADensityMatch | null = null;

  for (const query of queries) {
    const foods = await searchUsdaFoods(query, apiKey);

    for (const food of foods) {
      const details = await fetchUsdaFoodDetails(food.fdcId, apiKey);
      const portions = details.foodPortions ?? [];

      for (const portion of portions) {
        if (
          typeof portion.gramWeight !== "number" ||
          !Number.isFinite(portion.gramWeight) ||
          portion.gramWeight <= 0
        ) {
          continue;
        }

        const resolvedVolume = resolvePortionVolumeUnit(portion);
        if (!resolvedVolume) continue;

        const volumeMilliliters =
          resolvedVolume.amount * EXACT_UNIT_FACTORS[resolvedVolume.unit].factor;
        if (!Number.isFinite(volumeMilliliters) || volumeMilliliters <= 0) {
          continue;
        }

        const gramsPerMilliliter = portion.gramWeight / volumeMilliliters;
        if (!Number.isFinite(gramsPerMilliliter) || gramsPerMilliliter <= 0) {
          continue;
        }

        const candidateScore =
          scoreFoodCandidate(food, ingredientName) +
          scorePortionCandidate(
            resolvedVolume.label,
            ingredientName,
            resolvedVolume.unit,
            preferredVolumeUnit
          );

        if (!bestMatch || candidateScore > bestMatch.score) {
          bestMatch = {
            gramsPerMilliliter,
            fdcId: details.fdcId,
            description: details.description,
            dataType: details.dataType,
            portionLabel: resolvedVolume.label,
            score: candidateScore,
          };
        }
      }
    }

    if (bestMatch) {
      return bestMatch;
    }
  }

  return bestMatch;
}

export async function convertIngredientQuantity(params: {
  ingredientName: string;
  quantity: string;
  fromUnit: string;
  toUnit: string;
}): Promise<ConvertedIngredientQuantity> {
  const { ingredientName, quantity, fromUnit, toUnit } = params;

  const parsedQuantity = parseQuantityExpression(quantity);
  if (!parsedQuantity) {
    throw new Error("Could not parse quantity for conversion");
  }

  const normalizedFromUnit = normalizeExactUnit(fromUnit);
  const normalizedToUnit = normalizeExactUnit(toUnit);
  if (!normalizedFromUnit || !normalizedToUnit) {
    throw new Error("Unsupported unit for conversion");
  }

  const fromMetadata = EXACT_UNIT_FACTORS[normalizedFromUnit];
  const toMetadata = EXACT_UNIT_FACTORS[normalizedToUnit];

  if (fromMetadata.category === toMetadata.category) {
    const convertedValues = parsedQuantity.values.map(
      (value) => (value * fromMetadata.factor) / toMetadata.factor
    );
    return {
      convertedQuantity: formatConvertedExpression(convertedValues, parsedQuantity.isRange),
      convertedValues,
      averageValue:
        convertedValues.reduce((sum, value) => sum + value, 0) / convertedValues.length,
      fromUnit,
      toUnit: normalizedToUnit,
    };
  }

  const apiKey = process.env.USDA_FDC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("USDA_FDC_API_KEY is not configured");
  }

  const preferredVolumeUnit =
    fromMetadata.category === "volume" ? normalizedFromUnit : normalizedToUnit;
  const densityMatch = await findUsdaDensityMatch(ingredientName, preferredVolumeUnit, apiKey);
  if (!densityMatch) {
    throw new Error(
      "No USDA Foundation Foods or SR Legacy density data was found for this ingredient and unit pair"
    );
  }

  const convertedValues = parsedQuantity.values.map((value) => {
    if (fromMetadata.category === "volume") {
      const sourceVolumeMilliliters = value * fromMetadata.factor;
      const sourceGrams = sourceVolumeMilliliters * densityMatch.gramsPerMilliliter;
      return sourceGrams / toMetadata.factor;
    }

    const sourceGrams = value * fromMetadata.factor;
    const sourceVolumeMilliliters = sourceGrams / densityMatch.gramsPerMilliliter;
    return sourceVolumeMilliliters / toMetadata.factor;
  });

  return {
    convertedQuantity: formatConvertedExpression(convertedValues, parsedQuantity.isRange),
    convertedValues,
    averageValue: convertedValues.reduce((sum, value) => sum + value, 0) / convertedValues.length,
    fromUnit,
    toUnit: normalizedToUnit,
    source: {
      provider: "USDA FoodData Central",
      dataType: densityMatch.dataType,
      fdcId: densityMatch.fdcId,
      description: densityMatch.description,
      portion: densityMatch.portionLabel,
    },
  };
}
