import { normalizeQuantityText } from "@/lib/recipeSteps";

/**
 * Pure unit vocabulary — aliases, conversion factors, and the parsing helpers
 * built on them. Split out of `unitConversion.ts` (which instantiates the
 * Anthropic SDK at module scope, making it server-only) so client components
 * such as the receipt price graph can normalize units without pulling the SDK
 * into the browser bundle. `unitConversion` re-exports the public names, so
 * existing server-side importers are unaffected.
 */

export type ExactUnitCategory = "mass" | "volume";

export type ExactUnit = keyof typeof EXACT_UNIT_FACTORS;

/** Factors are grams for mass units and milliliters for volume units. */
export const EXACT_UNIT_FACTORS = {
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

export function extractUnitFromText(value: string): ExactUnit | null {
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
