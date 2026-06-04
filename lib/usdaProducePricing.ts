import { IngredientPriceEstimate } from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";
import { convertIngredientQuantity, normalizeExactUnit } from "@/lib/unitConversion";

const USDA_PRODUCE_PAGE_URL = "https://www.ers.usda.gov/data-products/fruit-and-vegetable-prices";
const USDA_FRUITS_CSV_URL =
  "https://www.ers.usda.gov/media/6210/all-fruits-average-prices-csv-format.csv";
const USDA_VEGETABLES_CSV_URL =
  "https://www.ers.usda.gov/media/6240/all-vegetables-average-prices-csv-format.csv";
const USDA_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const TOKEN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "baby",
  "fresh",
  "large",
  "medium",
  "of",
  "raw",
  "small",
  "the",
  "whole",
  "with",
]);

const PRODUCE_MATCH_ALIASES: Array<{ pattern: RegExp; values: string[] }> = [
  {
    pattern: /\b(scallions?|green onions?|spring onions?)\b/i,
    values: ["onions"],
  },
  {
    pattern: /\b(bell peppers?|capsicum)\b/i,
    values: ["green peppers", "red peppers"],
  },
  {
    pattern: /\b(cherry tomatoes?|grape tomatoes?)\b/i,
    values: ["tomatoes grape and cherry"],
  },
  {
    pattern: /\b(roma tomatoes?|plum tomatoes?)\b/i,
    values: ["tomatoes roma and plum"],
  },
  {
    pattern: /\btomatoes?\b/i,
    values: ["tomatoes large round"],
  },
  {
    pattern: /\bmushrooms?\b/i,
    values: ["mushrooms sliced", "mushrooms whole"],
  },
  {
    pattern: /\bspinach\b/i,
    values: ["spinach eaten raw"],
  },
  {
    pattern: /\blettuce\b/i,
    values: ["lettuce romaine heads", "lettuce iceberg"],
  },
  {
    pattern: /\bcelery\b/i,
    values: ["celery sticks", "celery trimmed bunches"],
  },
  {
    pattern: /\bcucumbers?\b/i,
    values: ["cucumbers with peel"],
  },
  {
    pattern: /\bbroccoli\b/i,
    values: ["broccoli heads", "broccoli florets"],
  },
  {
    pattern: /\bcarrots?\b/i,
    values: ["carrots raw whole"],
  },
  {
    pattern: /\bavocados?\b/i,
    values: ["avocados"],
  },
  {
    pattern: /\bcourgette\b/i,
    values: ["zucchini"],
  },
] as const;

interface ProduceSearchPlan {
  canonicalName: string;
  searchQueries: string[];
  pricingUnit: "count" | "g" | "ml";
  pricingQuantity: number | null;
}

interface UsdaProduceRow {
  itemName: string;
  form: string;
  averageRetailPrice: number;
  retailUnit: string;
  averagePricePerCupEquivalent: number;
  normalizedName: string;
  tokens: string[];
}

const produceRowsCache = new Map<
  string,
  { expiresAt: number; value: Promise<UsdaProduceRow[]> }
>();

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return cleanText(
    value
      .toLowerCase()
      .replace(/[_-]/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
  );
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

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !TOKEN_STOPWORDS.has(token))
    .map((token) => singularize(token));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const normalized = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cleanText(cell).length > 0));
}

function parseProduceCsv(text: string, kind: "fruit" | "vegetable"): UsdaProduceRow[] {
  const rows = parseCsv(text);
  if (rows.length <= 1) return [];

  const [header, ...body] = rows;
  const indexByName = new Map(
    header.map((name, index) => [normalizeText(name), index] as const)
  );
  const nameKey = kind === "fruit" ? "fruit" : "vegetable";

  return body
    .map((row) => {
      const itemName = cleanText(row[indexByName.get(nameKey) ?? -1] ?? "");
      const form = cleanText(row[indexByName.get("form") ?? -1] ?? "");
      const averageRetailPrice = Number(
        row[indexByName.get("averageretailprice") ?? -1] ?? ""
      );
      const retailUnit = cleanText(
        row[indexByName.get("averageretailpriceunitofmeasure") ?? -1] ?? ""
      );
      const averagePricePerCupEquivalent = Number(
        row[indexByName.get("averagepricepercupequivalent") ?? -1] ?? ""
      );

      if (
        !itemName ||
        !form ||
        !Number.isFinite(averageRetailPrice) ||
        averageRetailPrice <= 0 ||
        !retailUnit ||
        !Number.isFinite(averagePricePerCupEquivalent) ||
        averagePricePerCupEquivalent <= 0
      ) {
        return null;
      }

      const normalizedName = normalizeText(itemName);
      return {
        itemName,
        form,
        averageRetailPrice,
        retailUnit,
        averagePricePerCupEquivalent,
        normalizedName,
        tokens: tokenize(itemName),
      };
    })
    .filter((row): row is UsdaProduceRow => Boolean(row))
    .filter((row) => row.form.toLowerCase() === "fresh");
}

async function fetchProduceRows(url: string, kind: "fruit" | "vegetable"): Promise<UsdaProduceRow[]> {
  return getCachedPromise(produceRowsCache, `${kind}:${url}`, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`USDA ERS produce price request failed with status ${response.status}`);
    }

    const text = await response.text();
    return parseProduceCsv(text, kind);
  });
}

async function getAllProduceRows(): Promise<UsdaProduceRow[]> {
  const [fruits, vegetables] = await Promise.all([
    fetchProduceRows(USDA_FRUITS_CSV_URL, "fruit"),
    fetchProduceRows(USDA_VEGETABLES_CSV_URL, "vegetable"),
  ]);

  return [...fruits, ...vegetables];
}

function expandProduceQueries(ingredient: Ingredient, searchPlan: ProduceSearchPlan): string[] {
  const values = [
    ingredient.name,
    searchPlan.canonicalName,
    ...searchPlan.searchQueries,
  ];

  for (const alias of PRODUCE_MATCH_ALIASES) {
    if (values.some((value) => alias.pattern.test(value))) {
      values.push(...alias.values);
    }
  }

  return dedupe(values);
}

function scoreProduceRow(row: UsdaProduceRow, query: string): { score: number; coverage: number } {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { score: -Infinity, coverage: 0 };
  }

  const matchedCount = queryTokens.filter((token) => row.tokens.includes(token)).length;
  if (matchedCount === 0) {
    return { score: -Infinity, coverage: 0 };
  }

  const coverage = matchedCount / queryTokens.length;
  const exactPhraseMatch = row.normalizedName.includes(normalizeText(query));
  const tokenPenalty = Math.max(0, row.tokens.length - matchedCount - 2) * 0.8;

  let score = matchedCount * 4 + coverage * 6 - tokenPenalty;

  if (exactPhraseMatch) {
    score += 4;
  }

  if (
    row.normalizedName.includes("raw") &&
    /\b(raw|baby|salad|spinach|lettuce)\b/i.test(query)
  ) {
    score += 1.5;
  }

  return { score, coverage };
}

function findBestProduceRow(
  ingredient: Ingredient,
  searchPlan: ProduceSearchPlan,
  rows: UsdaProduceRow[]
): { row: UsdaProduceRow; score: number; coverage: number } | null {
  const queries = expandProduceQueries(ingredient, searchPlan);
  let best: { row: UsdaProduceRow; score: number; coverage: number } | null = null;

  for (const query of queries) {
    for (const row of rows) {
      const candidate = scoreProduceRow(row, query);
      if (!Number.isFinite(candidate.score)) continue;

      if (
        !best ||
        candidate.score > best.score ||
        (candidate.score === best.score && candidate.coverage > best.coverage)
      ) {
        best = {
          row,
          score: candidate.score,
          coverage: candidate.coverage,
        };
      }
    }
  }

  if (!best) return null;
  if (best.score < 6 || best.coverage < 0.5) return null;
  return best;
}

async function convertProduceQuantityToPounds(
  ingredient: Ingredient,
  searchPlan: ProduceSearchPlan
): Promise<number | null> {
  try {
    const converted = await convertIngredientQuantity({
      ingredientName: searchPlan.canonicalName || ingredient.name,
      quantity: ingredient.quantity,
      fromUnit: ingredient.unit,
      toUnit: "lb",
    });
    return converted.averageValue > 0 ? converted.averageValue : null;
  } catch {
    if (searchPlan.pricingUnit === "g" && searchPlan.pricingQuantity && searchPlan.pricingQuantity > 0) {
      return searchPlan.pricingQuantity / 453.59237;
    }

    return null;
  }
}

async function convertProduceQuantityToCups(
  ingredient: Ingredient,
  searchPlan: ProduceSearchPlan
): Promise<number | null> {
  try {
    const converted = await convertIngredientQuantity({
      ingredientName: searchPlan.canonicalName || ingredient.name,
      quantity: ingredient.quantity,
      fromUnit: ingredient.unit,
      toUnit: "cup",
    });
    return converted.averageValue > 0 ? converted.averageValue : null;
  } catch {
    if (searchPlan.pricingUnit === "ml" && searchPlan.pricingQuantity && searchPlan.pricingQuantity > 0) {
      return searchPlan.pricingQuantity / 236.5882365;
    }

    return null;
  }
}

function buildUsdaProduceEstimate(params: {
  ingredient: Ingredient;
  row: UsdaProduceRow;
  adjustedPrice: number;
  packagePrice: number;
  packageSizeText: string;
  coverage: number;
}): IngredientPriceEstimate {
  const { ingredient, row, adjustedPrice, packagePrice, packageSizeText, coverage } = params;

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice,
    adjustedPriceText: formatUsd(adjustedPrice),
    packagePrice,
    packagePriceText: formatUsd(packagePrice),
    packageSizeText,
    matchTitle: row.itemName,
    matchUrl: USDA_PRODUCE_PAGE_URL,
    matchStore: undefined,
    confidence: clampConfidence(0.55 + coverage * 0.35),
    explanation: `USDA ERS national average retail price for fresh ${row.itemName.toLowerCase()}.`,
    unavailableReason: null,
    source: "usda",
  };
}

export async function estimateProduceIngredientPrice(
  ingredient: Ingredient,
  searchPlan: ProduceSearchPlan
): Promise<IngredientPriceEstimate | null> {
  if (ingredient.section !== "Produce") {
    return null;
  }

  const rows = await getAllProduceRows();
  const matched = findBestProduceRow(ingredient, searchPlan, rows);
  if (!matched) {
    return null;
  }

  const normalizedUnit = normalizeExactUnit(ingredient.unit);
  const preferCupEquivalent =
    normalizedUnit === "cup" ||
    normalizedUnit === "tbsp" ||
    normalizedUnit === "tsp" ||
    normalizedUnit === "fl oz" ||
    normalizedUnit === "ml" ||
    normalizedUnit === "l" ||
    normalizedUnit === "pint" ||
    normalizedUnit === "quart" ||
    normalizedUnit === "gallon" ||
    searchPlan.pricingUnit === "ml";

  if (preferCupEquivalent) {
    const cups = await convertProduceQuantityToCups(ingredient, searchPlan);
    if (cups !== null) {
      const packagePrice = roundToCents(matched.row.averagePricePerCupEquivalent);
      const adjustedPrice = roundToCents(packagePrice * cups);
      return buildUsdaProduceEstimate({
        ingredient,
        row: matched.row,
        adjustedPrice,
        packagePrice,
        packageSizeText: "1 cup equivalent",
        coverage: matched.coverage,
      });
    }
  }

  const pounds = await convertProduceQuantityToPounds(ingredient, searchPlan);
  if (pounds !== null && matched.row.retailUnit.toLowerCase().includes("per pound")) {
    const packagePrice = roundToCents(matched.row.averageRetailPrice);
    const adjustedPrice = roundToCents(packagePrice * pounds);
    return buildUsdaProduceEstimate({
      ingredient,
      row: matched.row,
      adjustedPrice,
      packagePrice,
      packageSizeText: "1 lb",
      coverage: matched.coverage,
    });
  }

  if (!preferCupEquivalent) {
    const cups = await convertProduceQuantityToCups(ingredient, searchPlan);
    if (cups !== null) {
      const packagePrice = roundToCents(matched.row.averagePricePerCupEquivalent);
      const adjustedPrice = roundToCents(packagePrice * cups);
      return buildUsdaProduceEstimate({
        ingredient,
        row: matched.row,
        adjustedPrice,
        packagePrice,
        packageSizeText: "1 cup equivalent",
        coverage: matched.coverage,
      });
    }
  }

  return null;
}
