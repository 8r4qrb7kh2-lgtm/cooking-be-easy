import Anthropic from "@anthropic-ai/sdk";
import { Cheerio, CheerioAPI, load } from "cheerio";
import { AnyNode } from "domhandler";
import { NextRequest, NextResponse } from "next/server";
import { RecipePriceEstimate, IngredientPriceEstimate } from "@/lib/recipePricing";
import { Ingredient } from "@/lib/types";

export const runtime = "nodejs";

const client = new Anthropic();

const AMAZON_RESULT_LIMIT = 5;
const AMAZON_SEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const ANTHROPIC_PRICING_BATCH_SIZE = 6;
const PRICING_TOOL_NAME = "report_pricing_decisions";
const AMAZON_SEARCH_HEADERS = {
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
} as const;

const SEARCH_CLEANUP_PATTERNS = [
  /\([^)]*\)/g,
  /\bfor serving\b/gi,
  /\bdivided\b/gi,
  /\bto taste\b/gi,
  /\bplus more\b[\w\s-]*/gi,
  /\bas needed\b/gi,
  /[,+/]/g,
] as const;

const amazonSearchCache = new Map<
  string,
  { expiresAt: number; value: Promise<AmazonSearchCandidate[]> }
>();

interface AmazonSearchCandidate {
  asin: string;
  title: string;
  url: string;
  price: number;
  priceText: string;
  preview: string;
}

interface RecipePricingRequest {
  recipeName?: string;
  ingredients?: Ingredient[];
}

interface AiIngredientPricingDecision {
  ingredientId?: unknown;
  matchTitle?: unknown;
  matchUrl?: unknown;
  amazonPrice?: unknown;
  adjustedPrice?: unknown;
  confidence?: unknown;
  explanation?: unknown;
  unavailableReason?: unknown;
}

interface AiPricingResponsePayload {
  ingredients?: AiIngredientPricingDecision[];
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
    expiresAt: now + AMAZON_SEARCH_CACHE_TTL_MS,
    value,
  });

  return value;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parsePriceText(value: string): number | null {
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
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

function buildAmazonSearchQuery(ingredientName: string): string {
  const cleaned = SEARCH_CLEANUP_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, " "),
    ingredientName
  );

  return (
    cleanText(cleaned)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ") || cleanText(ingredientName)
  );
}

function isAmazonRobotCheck(html: string): boolean {
  const normalized = html.toLowerCase();
  return (
    normalized.includes("enter the characters you see below") ||
    normalized.includes("sorry, we just need to make sure you're not a robot")
  );
}

function dedupeCandidates(candidates: AmazonSearchCandidate[]): AmazonSearchCandidate[] {
  const seen = new Set<string>();
  const output: AmazonSearchCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.asin}:${candidate.priceText}:${candidate.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }

  return output;
}

function collectCardPreview($: CheerioAPI, card: Cheerio<AnyNode>, title: string): string {
  const parts = card
    .find(".a-size-base, .a-size-small, .a-size-mini")
    .map((_, node) => cleanText($(node).text()))
    .get()
    .filter(Boolean)
    .filter((text) => text !== title)
    .filter((text, index, values) => values.indexOf(text) === index)
    .slice(0, 10);

  return cleanText(parts.join(" | ")).slice(0, 320);
}

function extractAmazonSearchCandidates(html: string): AmazonSearchCandidate[] {
  const $ = load(html);
  const results: AmazonSearchCandidate[] = [];

  $('[data-component-type="s-search-result"][data-asin]').each((_, element) => {
    if (results.length >= AMAZON_RESULT_LIMIT) {
      return false;
    }

    const card = $(element);
    const asin = cleanText(card.attr("data-asin") ?? "");
    const heading = card.find("h2").first();
    const title = cleanText(heading.text());
    const href =
      heading.parent("a").attr("href") ??
      heading.closest("a").attr("href") ??
      card.find('a[href*="/dp/"]').first().attr("href");
    const priceText = cleanText(card.find(".a-price .a-offscreen").first().text());
    const price = parsePriceText(priceText);

    if (!asin || !href || !title || price === null) {
      return;
    }

    const url = new URL(href, "https://www.amazon.com").toString();
    const preview = collectCardPreview($, card, title);

    results.push({
      asin,
      title,
      url,
      price,
      priceText,
      preview,
    });
  });

  return dedupeCandidates(results).slice(0, AMAZON_RESULT_LIMIT);
}

async function searchAmazonCandidates(query: string): Promise<AmazonSearchCandidate[]> {
  return getCachedPromise(amazonSearchCache, query, async () => {
    const url = new URL("https://www.amazon.com/s");
    url.searchParams.set("k", query);
    url.searchParams.set("i", "grocery");

    const response = await fetch(url.toString(), {
      headers: AMAZON_SEARCH_HEADERS,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Amazon search failed with status ${response.status}`);
    }

    const html = await response.text();
    if (isAmazonRobotCheck(html)) {
      throw new Error("Amazon blocked the price lookup with a robot check");
    }

    return extractAmazonSearchCandidates(html);
  });
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

function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function sanitizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = cleanText(value);
  return normalized || undefined;
}

function sanitizeOptionalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    const url = new URL(value);
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeOptionalPrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function extractFirstJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (start === -1) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (character === "\\") {
        isEscaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function isToolUseBlockWithInput(
  value: unknown
): value is Anthropic.Messages.ToolUseBlock {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Anthropic.Messages.ToolUseBlock>;
  return (
    candidate.type === "tool_use" &&
    typeof candidate.name === "string" &&
    "input" in candidate
  );
}

function buildUnavailableEstimate(ingredient: Ingredient, reason: string): IngredientPriceEstimate {
  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice: null,
    adjustedPriceText: null,
    amazonPackagePrice: null,
    amazonPackagePriceText: null,
    confidence: null,
    unavailableReason: reason,
  };
}

function normalizeDecision(
  ingredient: Ingredient,
  decision: AiIngredientPricingDecision | undefined
): IngredientPriceEstimate {
  let adjustedPrice = sanitizeOptionalPrice(decision?.adjustedPrice);
  let amazonPackagePrice = sanitizeOptionalPrice(decision?.amazonPrice);
  const matchTitle = sanitizeOptionalText(decision?.matchTitle);
  const matchUrl = sanitizeOptionalUrl(decision?.matchUrl);
  const explanation = sanitizeOptionalText(decision?.explanation);
  const unavailableReason = sanitizeOptionalText(decision?.unavailableReason);
  const hasAmazonMatch = Boolean(matchTitle || matchUrl);

  if (!hasAmazonMatch && adjustedPrice === 0) {
    adjustedPrice = null;
  }

  if (!hasAmazonMatch && amazonPackagePrice === 0) {
    amazonPackagePrice = null;
  }

  if (adjustedPrice === null) {
    return {
      ...buildUnavailableEstimate(
        ingredient,
        unavailableReason ?? "Could not confidently convert an Amazon match to the recipe quantity."
      ),
      amazonPackagePrice,
      amazonPackagePriceText:
        amazonPackagePrice !== null ? formatUsd(amazonPackagePrice) : null,
      matchTitle,
      matchUrl,
      confidence: clampConfidence(decision?.confidence),
      explanation,
    };
  }

  return {
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    adjustedPrice,
    adjustedPriceText: formatUsd(adjustedPrice),
    amazonPackagePrice,
    amazonPackagePriceText:
      amazonPackagePrice !== null ? formatUsd(amazonPackagePrice) : null,
    matchTitle,
    matchUrl,
    confidence: clampConfidence(decision?.confidence),
    explanation,
    unavailableReason: null,
  };
}

function buildAnthropicPrompt(
  recipeName: string | undefined,
  items: Array<{ ingredient: Ingredient; candidates: AmazonSearchCandidate[] }>
): string {
  const payload = items.map(({ ingredient, candidates }) => ({
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    amazonResults: candidates.map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      price: candidate.price,
      priceText: candidate.priceText,
      preview: candidate.preview,
    })),
  }));

  return `You are estimating recipe ingredient costs from Amazon grocery search results.

Goal:
- Choose the single best edible grocery match for each ingredient from the provided Amazon results.
- Estimate the cost of only the recipe-required quantity, not the full package price.

Rules:
- Use only the provided Amazon data. Do not invent product sizes or prices.
- Prefer ordinary grocery products over bulk specialty packs when multiple matches are plausible.
- Reject cookware, appliances, books, supplements, pet food, and non-food items.
- Use direct arithmetic when the package size is clear from the title or preview.
- Standard kitchen conversions are allowed: 1 cup = 16 tbsp = 48 tsp = 8 fl oz; 1 tbsp = 3 tsp; 1 pint = 2 cups; 1 quart = 4 cups; 1 gallon = 16 cups; 1 lb = 16 oz; 1 kg = 1000 g; 1 L = 1000 ml.
- For count-based recipe units like egg, clove, can, stick, bunch, or loaf, only return an adjustedPrice when the Amazon result makes the count or package size clear enough to price confidently.
- If you cannot price an ingredient confidently, return adjustedPrice as null and fill unavailableReason with a short explanation.
- Round all prices to 2 decimals.
- Return only valid JSON.

Return exactly this shape:
{
  "ingredients": [
    {
      "ingredientId": "ingredient id",
      "matchTitle": "selected Amazon title or null",
      "matchUrl": "selected Amazon url or null",
      "amazonPrice": 0,
      "adjustedPrice": 0,
      "confidence": 0,
      "explanation": "brief pricing math or rationale",
      "unavailableReason": null
    }
  ]
}

Recipe name: ${recipeName ? JSON.stringify(recipeName) : '"Unnamed recipe"'}

Input:
${JSON.stringify(payload, null, 2)}`;
}

async function priceIngredientsWithAnthropic(
  recipeName: string | undefined,
  items: Array<{ ingredient: Ingredient; candidates: AmazonSearchCandidate[] }>
): Promise<Map<string, AiIngredientPricingDecision>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const toolSchema: Anthropic.Messages.Tool = {
    name: PRICING_TOOL_NAME,
    description: "Return one pricing decision for each ingredient using the provided Amazon search results.",
    input_schema: {
      type: "object",
      properties: {
        ingredients: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ingredientId: { type: "string" },
              matchTitle: { type: ["string", "null"] },
              matchUrl: { type: ["string", "null"] },
              amazonPrice: { type: ["number", "null"] },
              adjustedPrice: { type: ["number", "null"] },
              confidence: { type: ["number", "null"] },
              explanation: { type: ["string", "null"] },
              unavailableReason: { type: ["string", "null"] },
            },
            required: [
              "ingredientId",
              "matchTitle",
              "matchUrl",
              "amazonPrice",
              "adjustedPrice",
              "confidence",
              "explanation",
              "unavailableReason",
            ],
          },
        },
      },
      required: ["ingredients"],
    },
  };

  const message = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    temperature: 0,
    tools: [toolSchema],
    tool_choice: {
      type: "tool",
      name: PRICING_TOOL_NAME,
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildAnthropicPrompt(recipeName, items),
          },
        ],
      },
    ],
  });

  const toolUseBlock = message.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      isToolUseBlockWithInput(block) && block.name === PRICING_TOOL_NAME
  );

  if (toolUseBlock && toolUseBlock.input && typeof toolUseBlock.input === "object") {
    const parsed = toolUseBlock.input as AiPricingResponsePayload;
    const decisions = new Map<string, AiIngredientPricingDecision>();

    for (const decision of parsed.ingredients ?? []) {
      if (typeof decision.ingredientId !== "string") continue;
      decisions.set(decision.ingredientId, decision);
    }

    return decisions;
  }

  const text = message.content.reduce((output, block) => {
    if (block.type !== "text") return output;
    return output ? `${output}\n${block.text}` : block.text;
  }, "");

  const jsonObject = extractFirstJsonObject(text);
  if (!jsonObject) {
    throw new Error("Could not parse Amazon pricing response from Anthropic");
  }

  const parsed = JSON.parse(jsonObject) as AiPricingResponsePayload;
  const decisions = new Map<string, AiIngredientPricingDecision>();

  for (const decision of parsed.ingredients ?? []) {
    if (typeof decision.ingredientId !== "string") continue;
    decisions.set(decision.ingredientId, decision);
  }

  return decisions;
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecipePricingRequest;
    const ingredients = Array.isArray(body.ingredients)
      ? body.ingredients.filter(isIngredient)
      : [];

    if (ingredients.length === 0) {
      const emptyResponse: RecipePriceEstimate = {
        estimatedAt: new Date().toISOString(),
        currencyCode: "USD",
        totalAdjustedPrice: 0,
        totalAdjustedPriceText: formatUsd(0),
        resolvedIngredientCount: 0,
        unresolvedIngredientCount: 0,
        ingredients: [],
      };
      return NextResponse.json(emptyResponse);
    }

    const candidateSets = await mapWithConcurrency(ingredients, 4, async (ingredient) => ({
      ingredient,
      candidates: await searchAmazonCandidates(buildAmazonSearchQuery(ingredient.name)),
    }));

    const decisions = new Map<string, AiIngredientPricingDecision>();
    const batches = chunkItems(candidateSets, ANTHROPIC_PRICING_BATCH_SIZE);

    for (const batch of batches) {
      try {
        const batchDecisions = await priceIngredientsWithAnthropic(
          body.recipeName,
          batch
        );

        for (const [ingredientId, decision] of batchDecisions.entries()) {
          decisions.set(ingredientId, decision);
        }
      } catch (error) {
        console.error("Recipe pricing batch failed:", error);

        for (const { ingredient, candidates } of batch) {
          const firstCandidate = candidates[0];
          decisions.set(ingredient.id, {
            ingredientId: ingredient.id,
            matchTitle: firstCandidate?.title ?? null,
            matchUrl: firstCandidate?.url ?? null,
            amazonPrice: firstCandidate?.price ?? null,
            adjustedPrice: null,
            confidence: null,
            explanation: null,
            unavailableReason: firstCandidate
              ? "Amazon match found, but the quantity estimate could not be computed automatically."
              : "No usable Amazon grocery match was found.",
          });
        }
      }
    }

    const estimates = ingredients.map((ingredient) =>
      normalizeDecision(ingredient, decisions.get(ingredient.id))
    );

    const totalAdjustedPrice = Math.round(
      (estimates.reduce((sum, estimate) => sum + (estimate.adjustedPrice ?? 0), 0) +
        Number.EPSILON) *
        100
    ) / 100;

    const resolvedIngredientCount = estimates.filter(
      (estimate) => estimate.adjustedPrice !== null
    ).length;

    const response: RecipePriceEstimate = {
      estimatedAt: new Date().toISOString(),
      currencyCode: "USD",
      totalAdjustedPrice,
      totalAdjustedPriceText: formatUsd(totalAdjustedPrice),
      resolvedIngredientCount,
      unresolvedIngredientCount: estimates.length - resolvedIngredientCount,
      ingredients: estimates,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Recipe pricing error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to estimate Amazon ingredient prices",
      },
      { status: 500 }
    );
  }
}
