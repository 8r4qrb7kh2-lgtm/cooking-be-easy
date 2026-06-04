import Anthropic from "@anthropic-ai/sdk";
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

export type DensityProvider =
  | "built-in reference table"
  | "USDA FoodData Central"
  | "Claude estimate";

export interface IngredientDensity {
  gramsPerMilliliter: number;
  provider: DensityProvider;
  description: string;
}

export interface UnitConversionSource {
  provider: DensityProvider;
  dataType?: string;
  fdcId?: number;
  description: string;
  portion?: string;
}

export interface ConvertedIngredientQuantity {
  convertedQuantity: string;
  convertedValues: number[];
  averageValue: number;
  fromUnit: string;
  toUnit: ExactUnit;
  source?: UnitConversionSource;
}

export interface MeasureInGrams {
  grams: number;
  source: DensityProvider | "exact unit" | "package size" | "count weight";
  description: string;
}

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
const USDA_DATA_TYPES = ["Foundation", "SR Legacy"] as const;
const USDA_SEARCH_RESULT_LIMIT = 6;
const USDA_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const DENSITY_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DENSITY_CLAUDE_MODEL = "claude-haiku-4-5-20251001";

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
  c: "cup",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  tbsps: "tbsp",
  tbs: "tbsp",
  tbl: "tbsp",
  tsp: "tsp",
  tsps: "tsp",
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
  cc: "ml",
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
  gr: "g",
  gms: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilo: "kg",
  kilos: "kg",
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
  { unit: "tbsp", pattern: /\b(tablespoons?|table spoon|tbsps?|tbs|tbl)\b/i },
  { unit: "tsp", pattern: /\b(teaspoons?|tea spoon|tsps?)\b/i },
  { unit: "cup", pattern: /\bcups?\b/i },
  { unit: "ml", pattern: /\b(milliliters?|millilitres?|ml|cc)\b/i },
  { unit: "l", pattern: /\b(liters?|litres?|l)\b/i },
  { unit: "pint", pattern: /\b(pints?|pt)\b/i },
  { unit: "quart", pattern: /\b(quarts?|qt)\b/i },
  { unit: "gallon", pattern: /\b(gallons?|gal)\b/i },
  { unit: "kg", pattern: /\b(kilograms?|kg)\b/i },
  { unit: "g", pattern: /\b(grams?|g|gr)\b/i },
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

/**
 * Curated grams-per-milliliter densities for common cooking ingredients.
 * This is the fast, deterministic first tier of density resolution — it
 * answers the bulk of volume<->mass conversions without any network call.
 * Patterns are ordered specific -> general; the first match wins.
 */
const INGREDIENT_DENSITY_TABLE: Array<{
  pattern: RegExp;
  gramsPerMilliliter: number;
  label: string;
}> = [
  // Liquids
  { pattern: /\bwater\b/i, gramsPerMilliliter: 1.0, label: "water" },
  { pattern: /\b(whole milk|2% milk|skim milk|milk)\b/i, gramsPerMilliliter: 1.03, label: "milk" },
  { pattern: /\b(buttermilk)\b/i, gramsPerMilliliter: 1.03, label: "buttermilk" },
  { pattern: /\b(heavy cream|whipping cream|double cream)\b/i, gramsPerMilliliter: 0.99, label: "cream" },
  { pattern: /\b(half and half|half-and-half)\b/i, gramsPerMilliliter: 1.01, label: "half and half" },
  { pattern: /\b(coconut milk|coconut cream)\b/i, gramsPerMilliliter: 0.99, label: "coconut milk" },
  { pattern: /\b(almond milk|oat milk|soy milk|rice milk)\b/i, gramsPerMilliliter: 1.02, label: "plant milk" },
  { pattern: /\b(olive oil|vegetable oil|canola oil|sunflower oil|sesame oil|avocado oil|coconut oil|neutral oil|grapeseed oil|peanut oil|oil)\b/i, gramsPerMilliliter: 0.92, label: "cooking oil" },
  { pattern: /\b(honey)\b/i, gramsPerMilliliter: 1.42, label: "honey" },
  { pattern: /\b(maple syrup)\b/i, gramsPerMilliliter: 1.33, label: "maple syrup" },
  { pattern: /\b(agave|corn syrup|golden syrup|simple syrup|syrup)\b/i, gramsPerMilliliter: 1.37, label: "syrup" },
  { pattern: /\b(molasses)\b/i, gramsPerMilliliter: 1.4, label: "molasses" },
  { pattern: /\b(soy sauce|tamari|shoyu)\b/i, gramsPerMilliliter: 1.15, label: "soy sauce" },
  { pattern: /\b(fish sauce)\b/i, gramsPerMilliliter: 1.2, label: "fish sauce" },
  { pattern: /\b(worcestershire)\b/i, gramsPerMilliliter: 1.1, label: "worcestershire sauce" },
  { pattern: /\b(vinegar|rice wine|mirin)\b/i, gramsPerMilliliter: 1.01, label: "vinegar" },
  { pattern: /\b(broth|stock|bouillon|water)\b/i, gramsPerMilliliter: 1.0, label: "broth" },
  { pattern: /\b(wine|sake|beer|sherry)\b/i, gramsPerMilliliter: 0.99, label: "wine" },
  { pattern: /\b(lemon juice|lime juice|citrus juice|orange juice|juice)\b/i, gramsPerMilliliter: 1.03, label: "juice" },
  // Pastes, spreads & thick condiments
  { pattern: /\b(peanut butter|almond butter|cashew butter|sunflower butter|nut butter)\b/i, gramsPerMilliliter: 1.08, label: "nut butter" },
  { pattern: /\b(tahini)\b/i, gramsPerMilliliter: 1.05, label: "tahini" },
  { pattern: /\b(tomato paste)\b/i, gramsPerMilliliter: 1.1, label: "tomato paste" },
  { pattern: /\b(tomato sauce|marinara|passata|crushed tomato|tomato puree|tomato purée)\b/i, gramsPerMilliliter: 1.05, label: "tomato sauce" },
  { pattern: /\b(ketchup|catsup)\b/i, gramsPerMilliliter: 1.14, label: "ketchup" },
  { pattern: /\b(mustard)\b/i, gramsPerMilliliter: 1.05, label: "mustard" },
  { pattern: /\b(mayonnaise|mayo|aioli)\b/i, gramsPerMilliliter: 0.91, label: "mayonnaise" },
  { pattern: /\b(miso)\b/i, gramsPerMilliliter: 1.25, label: "miso paste" },
  { pattern: /\b(gochujang|chili crisp|chilli crisp|sambal|harissa|curry paste|chili paste|chilli paste|pesto|paste)\b/i, gramsPerMilliliter: 1.1, label: "thick paste" },
  { pattern: /\b(jam|jelly|preserves|marmalade)\b/i, gramsPerMilliliter: 1.3, label: "jam" },
  { pattern: /\b(yogurt|yoghurt|sour cream|creme fraiche|crème fraîche)\b/i, gramsPerMilliliter: 1.03, label: "cultured dairy" },
  { pattern: /\b(cream cheese|ricotta|mascarpone)\b/i, gramsPerMilliliter: 1.0, label: "soft cheese" },
  { pattern: /\b(hummus)\b/i, gramsPerMilliliter: 1.0, label: "hummus" },
  // Fats
  { pattern: /\b(butter|margarine|ghee|lard|shortening)\b/i, gramsPerMilliliter: 0.95, label: "butter" },
  // Sugars & sweet powders
  { pattern: /\b(powdered sugar|confectioners sugar|confectioner's sugar|icing sugar)\b/i, gramsPerMilliliter: 0.51, label: "powdered sugar" },
  { pattern: /\b(brown sugar)\b/i, gramsPerMilliliter: 0.93, label: "packed brown sugar" },
  { pattern: /\b(granulated sugar|caster sugar|white sugar|sugar)\b/i, gramsPerMilliliter: 0.85, label: "granulated sugar" },
  { pattern: /\b(cocoa|cacao)\b/i, gramsPerMilliliter: 0.51, label: "cocoa powder" },
  // Flours & dry baking
  { pattern: /\b(bread flour)\b/i, gramsPerMilliliter: 0.55, label: "bread flour" },
  { pattern: /\b(whole wheat flour|wholemeal flour)\b/i, gramsPerMilliliter: 0.56, label: "whole wheat flour" },
  { pattern: /\b(almond flour|almond meal)\b/i, gramsPerMilliliter: 0.4, label: "almond flour" },
  { pattern: /\b(flour)\b/i, gramsPerMilliliter: 0.53, label: "all-purpose flour" },
  { pattern: /\b(cornstarch|corn starch|cornflour)\b/i, gramsPerMilliliter: 0.54, label: "cornstarch" },
  { pattern: /\b(cornmeal|polenta|semolina)\b/i, gramsPerMilliliter: 0.67, label: "cornmeal" },
  { pattern: /\b(baking soda|bicarbonate)\b/i, gramsPerMilliliter: 0.93, label: "baking soda" },
  { pattern: /\b(baking powder)\b/i, gramsPerMilliliter: 0.9, label: "baking powder" },
  { pattern: /\b(breadcrumbs|panko|bread crumbs)\b/i, gramsPerMilliliter: 0.45, label: "breadcrumbs" },
  { pattern: /\b(rolled oats|oats|oatmeal)\b/i, gramsPerMilliliter: 0.38, label: "rolled oats" },
  // Salt
  { pattern: /\b(kosher salt|flaky salt|sea salt flakes)\b/i, gramsPerMilliliter: 0.69, label: "kosher salt" },
  { pattern: /\b(salt)\b/i, gramsPerMilliliter: 1.2, label: "table salt" },
  // Grains, legumes & nuts (dry, uncooked)
  { pattern: /\b(rice)\b/i, gramsPerMilliliter: 0.8, label: "uncooked rice" },
  { pattern: /\b(quinoa|couscous|bulgur|millet)\b/i, gramsPerMilliliter: 0.7, label: "small grain" },
  { pattern: /\b(lentils|split peas)\b/i, gramsPerMilliliter: 0.85, label: "dry lentils" },
  { pattern: /\b(chickpeas|garbanzo|black beans|kidney beans|white beans|dried beans|beans)\b/i, gramsPerMilliliter: 0.8, label: "dried beans" },
  { pattern: /\b(chopped nuts|walnuts|pecans|almonds|cashews|peanuts|pistachios|nuts)\b/i, gramsPerMilliliter: 0.5, label: "nuts" },
  { pattern: /\b(chocolate chips|chocolate chunks)\b/i, gramsPerMilliliter: 0.72, label: "chocolate chips" },
  // Cheeses (shredded/grated)
  { pattern: /\b(grated parmesan|grated parmigiano|grated pecorino)\b/i, gramsPerMilliliter: 0.42, label: "grated hard cheese" },
  { pattern: /\b(shredded cheese|grated cheese|shredded mozzarella|shredded cheddar)\b/i, gramsPerMilliliter: 0.45, label: "shredded cheese" },
];

/**
 * Approximate grams per single piece for common count-based ingredients.
 * Used to bridge "2 cloves garlic" <-> grams when pricing against a
 * weight-based receipt. Patterns test against "<name> <unit>" lowercased.
 */
const COUNT_WEIGHT_TABLE: Array<{ pattern: RegExp; grams: number; label: string }> = [
  { pattern: /\bgarlic\b.*\b(head|bulb)\b|\b(head|bulb)\b.*\bgarlic\b/i, grams: 50, label: "garlic head" },
  { pattern: /\bclove\b/i, grams: 5, label: "garlic clove" },
  { pattern: /\begg(s)?\b/i, grams: 50, label: "large egg" },
  { pattern: /\b(scallion|green onion|spring onion)\b/i, grams: 15, label: "scallion" },
  { pattern: /\bshallot\b/i, grams: 40, label: "shallot" },
  { pattern: /\bgarlic\b/i, grams: 5, label: "garlic clove" },
  { pattern: /\bonion\b/i, grams: 110, label: "medium onion" },
  { pattern: /\bcarrot\b/i, grams: 60, label: "medium carrot" },
  { pattern: /\bcelery\b.*\b(stalk|rib)\b|\b(stalk|rib)\b.*\bcelery\b|\bcelery\b/i, grams: 40, label: "celery stalk" },
  { pattern: /\b(bell pepper|capsicum)\b/i, grams: 120, label: "bell pepper" },
  { pattern: /\b(jalapeno|jalapeño|serrano|thai chili|thai chilli)\b/i, grams: 15, label: "small chili" },
  { pattern: /\b(roma tomato|plum tomato)\b/i, grams: 75, label: "roma tomato" },
  { pattern: /\b(cherry tomato|grape tomato)\b/i, grams: 17, label: "cherry tomato" },
  { pattern: /\btomato\b/i, grams: 120, label: "medium tomato" },
  { pattern: /\bpotato\b/i, grams: 170, label: "medium potato" },
  { pattern: /\b(lemon)\b/i, grams: 60, label: "lemon" },
  { pattern: /\b(lime)\b/i, grams: 45, label: "lime" },
  { pattern: /\b(orange)\b/i, grams: 130, label: "orange" },
  { pattern: /\b(avocado)\b/i, grams: 150, label: "avocado" },
  { pattern: /\b(banana)\b/i, grams: 118, label: "banana" },
  { pattern: /\b(apple)\b/i, grams: 180, label: "apple" },
  { pattern: /\b(mushroom)\b/i, grams: 18, label: "mushroom" },
  { pattern: /\b(bay leaf|bay leaves)\b/i, grams: 0.2, label: "bay leaf" },
];

const COUNT_FAMILY_ALIASES: Record<string, string> = {
  "": "generic",
  count: "generic",
  ct: "generic",
  each: "generic",
  ea: "generic",
  whole: "generic",
  piece: "generic",
  pieces: "generic",
  pc: "generic",
  pcs: "generic",
  unit: "generic",
  units: "generic",
  can: "can",
  cans: "can",
  jar: "jar",
  jars: "jar",
  bottle: "bottle",
  bottles: "bottle",
  package: "package",
  packages: "package",
  pkg: "package",
  pack: "package",
  packs: "package",
  packet: "packet",
  packets: "packet",
  box: "box",
  boxes: "box",
  bag: "bag",
  bags: "bag",
  bunch: "bunch",
  bunches: "bunch",
  head: "head",
  heads: "head",
  clove: "clove",
  cloves: "clove",
  sprig: "sprig",
  sprigs: "sprig",
  stalk: "stalk",
  stalks: "stalk",
  stick: "stick",
  sticks: "stick",
  slice: "slice",
  slices: "slice",
  loaf: "loaf",
  loaves: "loaf",
};

const anthropic = process.env.ANTHROPIC_API_KEY?.trim() ? new Anthropic() : null;

const searchCache = new Map<
  string,
  { expiresAt: number; value: Promise<USDASearchFood[]> }
>();
const detailCache = new Map<
  number,
  { expiresAt: number; value: Promise<USDAFoodDetails> }
>();
const densityCache = new Map<
  string,
  { expiresAt: number; value: Promise<IngredientDensity | null> }
>();

function getCachedPromise<K, V>(
  cache: Map<K, { expiresAt: number; value: Promise<V> }>,
  key: K,
  ttlMs: number,
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
    expiresAt: now + ttlMs,
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

export function getExactUnitCategory(unit: ExactUnit): ExactUnitCategory {
  return EXACT_UNIT_FACTORS[unit].category;
}

/** A unit is "count-like" when it is not a recognized exact mass/volume unit. */
export function isCountUnit(unit: string): boolean {
  return normalizeExactUnit(unit) === null;
}

/** Maps a count-like unit to a comparison family so receipt/recipe counts can be matched. */
export function countFamily(unit: string): string {
  const normalized = unit.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return COUNT_FAMILY_ALIASES[normalized] ?? normalized ?? "generic";
}

/** Two count units are compatible when they share a family or either is a generic count. */
export function countUnitsCompatible(unitA: string, unitB: string): boolean {
  const a = countFamily(unitA);
  const b = countFamily(unitB);
  if (a === b) return true;
  return a === "generic" || b === "generic";
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

/** Average numeric value of a quantity expression ("1-2" -> 1.5), or null. */
export function averageQuantityValue(quantity: string): number | null {
  const parsed = parseQuantityExpression(quantity);
  if (!parsed || parsed.values.length === 0) return null;
  const sum = parsed.values.reduce((total, value) => total + value, 0);
  const average = sum / parsed.values.length;
  return Number.isFinite(average) ? average : null;
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

/**
 * Parse a free-text package-size description ("15 fl oz bottle", "16 oz bag",
 * "1 lb", "500 g") into a measurable mass/volume amount. Returns null when the
 * package description has no measurable size (e.g. "1 bunch", "clamshell").
 */
export function parsePackageSize(
  text: string | undefined | null
): { value: number; unit: ExactUnit } | null {
  if (!text) return null;
  const normalized = normalizeQuantityText(text).toLowerCase();

  // Find a "<number> <unit>" pair anywhere in the string.
  const match = normalized.match(
    /(\d+(?:\.\d+)?)\s*(fl\s*oz|fluid\s*ounces?|floz|ml|milliliters?|millilitres?|cc|l|liters?|litres?|oz|ounces?|lb|lbs|pounds?|g|grams?|gr|kg|kilograms?|cups?|pints?|pt|quarts?|qt|gallons?|gal|tbsps?|tablespoons?|tsps?|teaspoons?)\b/i
  );
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = normalizeExactUnit(match[2]) ?? extractUnitFromText(match[2]);
  if (!unit) return null;

  return { value, unit };
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
  return getCachedPromise(searchCache, query, USDA_CACHE_TTL_MS, async () => {
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
  return getCachedPromise(detailCache, fdcId, USDA_CACHE_TTL_MS, async () => {
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

function lookupBuiltInDensity(ingredientName: string): IngredientDensity | null {
  const normalized = normalizeSearchText(ingredientName);
  if (!normalized) return null;

  for (const entry of INGREDIENT_DENSITY_TABLE) {
    if (entry.pattern.test(normalized)) {
      return {
        gramsPerMilliliter: entry.gramsPerMilliliter,
        provider: "built-in reference table",
        description: entry.label,
      };
    }
  }

  return null;
}

async function resolveDensityWithClaude(
  ingredientName: string
): Promise<IngredientDensity | null> {
  if (!anthropic) return null;

  try {
    const message = await anthropic.messages.create({
      model: DENSITY_CLAUDE_MODEL,
      max_tokens: 256,
      system:
        "You are a food-science reference. Given a cooking ingredient, return its typical density in grams per milliliter (g/mL) as prepared for recipes. Examples: water 1.0, all-purpose flour 0.53, granulated sugar 0.85, honey 1.42, olive oil 0.92, table salt 1.2, kosher salt 0.69, brown sugar (packed) 0.93, rolled oats 0.38. Use the form the ingredient is typically measured in. Always return a positive number; never refuse.",
      tools: [
        {
          name: "submit_density",
          description: "Submit the ingredient's density in grams per milliliter.",
          input_schema: {
            type: "object",
            properties: {
              gramsPerMilliliter: {
                type: "number",
                description: "Density in g/mL, e.g. 0.53 for flour, 1.42 for honey.",
              },
              note: {
                type: "string",
                description: "Short note on the assumed form (e.g. 'packed', 'sifted').",
              },
            },
            required: ["gramsPerMilliliter"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_density" },
      messages: [
        {
          role: "user",
          content: `Density in g/mL for this cooking ingredient: "${ingredientName}".`,
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;

    const input = toolUse.input as { gramsPerMilliliter?: unknown; note?: unknown };
    const value =
      typeof input.gramsPerMilliliter === "number"
        ? input.gramsPerMilliliter
        : Number(input.gramsPerMilliliter);

    if (!Number.isFinite(value) || value <= 0 || value > 25) return null;

    return {
      gramsPerMilliliter: value,
      provider: "Claude estimate",
      description:
        typeof input.note === "string" && input.note.trim()
          ? `Claude density estimate (${input.note.trim()})`
          : "Claude density estimate",
    };
  } catch (error) {
    console.error("Claude density lookup failed for:", ingredientName, error);
    return null;
  }
}

/**
 * Resolve a per-ingredient density (g/mL) using a layered strategy:
 *   1. Built-in reference table (instant, deterministic, covers common items)
 *   2. USDA FoodData Central volume portions (authoritative, needs API key)
 *   3. Claude estimate (covers the long tail of any ingredient)
 * Results are cached so repeated lookups for the same ingredient are free.
 */
export async function resolveIngredientDensity(
  ingredientName: string,
  options: { preferredVolumeUnit?: ExactUnit | null } = {}
): Promise<IngredientDensity | null> {
  const trimmed = ingredientName.trim();
  if (!trimmed) return null;

  const cacheKey = normalizeSearchText(trimmed) || trimmed.toLowerCase();

  return getCachedPromise(densityCache, cacheKey, DENSITY_CACHE_TTL_MS, async () => {
    const builtIn = lookupBuiltInDensity(trimmed);
    if (builtIn) return builtIn;

    const apiKey = process.env.USDA_FDC_API_KEY?.trim();
    if (apiKey) {
      try {
        const usdaMatch = await findUsdaDensityMatch(
          trimmed,
          options.preferredVolumeUnit ?? null,
          apiKey
        );
        if (usdaMatch) {
          return {
            gramsPerMilliliter: usdaMatch.gramsPerMilliliter,
            provider: "USDA FoodData Central",
            description: usdaMatch.description,
          };
        }
      } catch (error) {
        console.error("USDA density lookup failed for:", trimmed, error);
      }
    }

    return resolveDensityWithClaude(trimmed);
  });
}

function lookupCountWeight(ingredientName: string, unit: string): number | null {
  const haystack = `${ingredientName} ${unit}`.toLowerCase();
  for (const entry of COUNT_WEIGHT_TABLE) {
    if (entry.pattern.test(haystack)) {
      return entry.grams;
    }
  }
  return null;
}

/**
 * Convert any (quantity, unit) for a named ingredient into grams. Handles:
 *   - exact mass units (g, kg, oz, lb)
 *   - exact volume units (cup, tbsp, ml, ...) via resolved density
 *   - count units when a measurable package size is known, or via the
 *     count-weight reference table (e.g. "2 cloves garlic")
 * Returns null when no reliable conversion is possible.
 */
export async function convertMeasureToGrams(params: {
  ingredientName: string;
  quantity: number | string;
  unit: string;
  packageSizeText?: string | null;
}): Promise<MeasureInGrams | null> {
  const { ingredientName, unit, packageSizeText } = params;

  const value =
    typeof params.quantity === "number"
      ? params.quantity
      : averageQuantityValue(params.quantity);
  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  const exactUnit = normalizeExactUnit(unit);

  if (exactUnit) {
    const metadata = EXACT_UNIT_FACTORS[exactUnit];
    if (metadata.category === "mass") {
      return {
        grams: value * metadata.factor,
        source: "exact unit",
        description: `${exactUnit} (mass)`,
      };
    }

    // Volume unit -> grams requires the ingredient's density.
    const density = await resolveIngredientDensity(ingredientName, {
      preferredVolumeUnit: exactUnit,
    });
    if (!density) return null;
    const milliliters = value * metadata.factor;
    return {
      grams: milliliters * density.gramsPerMilliliter,
      source: density.provider,
      description: `${exactUnit} via ${density.description} density`,
    };
  }

  // Count-like unit. Prefer an explicit measurable package size.
  const packageSize = parsePackageSize(packageSizeText);
  if (packageSize) {
    const perPackage = await convertMeasureToGrams({
      ingredientName,
      quantity: packageSize.value,
      unit: packageSize.unit,
    });
    if (perPackage) {
      return {
        grams: value * perPackage.grams,
        source: "package size",
        description: `${value} x ${packageSizeText}`,
      };
    }
  }

  const gramsPerCount = lookupCountWeight(ingredientName, unit);
  if (gramsPerCount !== null) {
    return {
      grams: value * gramsPerCount,
      source: "count weight",
      description: `${value} x ${unit || "each"} (reference weight)`,
    };
  }

  return null;
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

  const preferredVolumeUnit =
    fromMetadata.category === "volume" ? normalizedFromUnit : normalizedToUnit;
  const density = await resolveIngredientDensity(ingredientName, { preferredVolumeUnit });
  if (!density) {
    throw new Error(
      "Could not determine a reliable density for this ingredient to convert between volume and mass."
    );
  }

  const convertedValues = parsedQuantity.values.map((value) => {
    if (fromMetadata.category === "volume") {
      const sourceVolumeMilliliters = value * fromMetadata.factor;
      const sourceGrams = sourceVolumeMilliliters * density.gramsPerMilliliter;
      return sourceGrams / toMetadata.factor;
    }

    const sourceGrams = value * fromMetadata.factor;
    const sourceVolumeMilliliters = sourceGrams / density.gramsPerMilliliter;
    return sourceVolumeMilliliters / toMetadata.factor;
  });

  return {
    convertedQuantity: formatConvertedExpression(convertedValues, parsedQuantity.isRange),
    convertedValues,
    averageValue: convertedValues.reduce((sum, value) => sum + value, 0) / convertedValues.length,
    fromUnit,
    toUnit: normalizedToUnit,
    source: {
      provider: density.provider,
      description: density.description,
    },
  };
}
