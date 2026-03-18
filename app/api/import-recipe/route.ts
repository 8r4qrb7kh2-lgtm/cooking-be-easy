import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { normalizeRecipeSteps } from "@/lib/recipeSteps";

const client = new Anthropic();

type JsonObject = Record<string, unknown>;

interface StructuredRecipeCandidate {
  name: string;
  ingredients: string[];
  steps: string[];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&frac12;/g, "½")
    .replace(/&frac14;/g, "¼")
    .replace(/&frac34;/g, "¾");
}

function normalizeTextFragment(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");

  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanJsonLdPayload(payload: string): string {
  return payload
    .replace(/^\s*<!--\s*/, "")
    .replace(/\s*-->\s*$/, "")
    .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\/\s*/, "")
    .replace(/\s*\/\*\s*\]\]>\s*\*\/\s*$/, "")
    .trim();
}

function collectJsonLdNodes(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonLdNodes(item));
  }

  if (!isJsonObject(value)) {
    return [];
  }

  const nodes = [value];
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    nodes.push(...collectJsonLdNodes(graph));
  }

  return nodes;
}

function hasSchemaType(value: unknown, expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  const values = Array.isArray(value) ? value : [value];

  return values.some((item) => {
    if (typeof item !== "string") return false;
    const normalized = item.toLowerCase();
    const tail = normalized.split("/").pop() ?? normalized;
    return (
      normalized === normalizedExpected ||
      tail === normalizedExpected ||
      normalized.endsWith(`:${normalizedExpected}`) ||
      normalized.endsWith(`/${normalizedExpected}`)
    );
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeTextFragment(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function extractIngredientTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractIngredientTexts(item));
  }

  if (typeof value === "string") {
    const normalized = normalizeTextFragment(value);
    return normalized ? [normalized] : [];
  }

  if (!isJsonObject(value)) {
    return [];
  }

  if (typeof value.name === "string") {
    const normalized = normalizeTextFragment(value.name);
    return normalized ? [normalized] : [];
  }

  if (typeof value.text === "string") {
    const normalized = normalizeTextFragment(value.text);
    return normalized ? [normalized] : [];
  }

  return [];
}

function extractInstructionTexts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractInstructionTexts(item));
  }

  if (typeof value === "string") {
    const normalized = normalizeTextFragment(value);
    return normalized ? [normalized] : [];
  }

  if (!isJsonObject(value)) {
    return [];
  }

  const nestedItems = value.itemListElement;
  if (Array.isArray(nestedItems)) {
    return extractInstructionTexts(nestedItems);
  }

  const nestedSteps = value.steps;
  if (Array.isArray(nestedSteps)) {
    return extractInstructionTexts(nestedSteps);
  }

  if (typeof value.text === "string") {
    const normalized = normalizeTextFragment(value.text);
    return normalized ? [normalized] : [];
  }

  if (typeof value.name === "string" && hasSchemaType(value["@type"], "HowToStep")) {
    const normalized = normalizeTextFragment(value.name);
    return normalized ? [normalized] : [];
  }

  return [];
}

function extractRecipeCandidatesFromJsonLd(html: string): StructuredRecipeCandidate[] {
  const matches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  const candidates: StructuredRecipeCandidate[] = [];

  for (const match of matches) {
    const payload = cleanJsonLdPayload(match[1] ?? "");
    if (!payload) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    for (const node of collectJsonLdNodes(parsed)) {
      if (!hasSchemaType(node["@type"], "Recipe")) continue;

      const name = typeof node.name === "string" ? normalizeTextFragment(node.name) : "";
      const ingredients = uniqueStrings(extractIngredientTexts(node.recipeIngredient));
      const steps = uniqueStrings(extractInstructionTexts(node.recipeInstructions));

      if (name || ingredients.length > 0 || steps.length > 0) {
        candidates.push({ name, ingredients, steps });
      }
    }
  }

  return candidates;
}

function pickBestStructuredRecipe(
  candidates: StructuredRecipeCandidate[]
): StructuredRecipeCandidate | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const bestScore =
      (best.name ? 20 : 0) + best.ingredients.length * 3 + best.steps.length * 2;
    const candidateScore =
      (candidate.name ? 20 : 0) +
      candidate.ingredients.length * 3 +
      candidate.steps.length * 2;

    return candidateScore > bestScore ? candidate : best;
  });
}

function extractPageTitle(html: string): string {
  const patterns = [
    /<meta[^>]+property=["']og:title["'][^>]+content=(["'])([\s\S]*?)\1[^>]*>/i,
    /<meta[^>]+content=(["'])([\s\S]*?)\1[^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=(["'])([\s\S]*?)\1[^>]*>/i,
    /<meta[^>]+content=(["'])([\s\S]*?)\1[^>]+name=["']twitter:title["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = match?.[2] ?? match?.[1];
    if (!value) continue;
    const normalized = normalizeTextFragment(value);
    if (normalized) return normalized;
  }

  return "";
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    let html: string;
    try {
      const fetchHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      };

      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        res = await fetch(url, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(15000),
        });
        if (res.status !== 429) break;
      }

      if (!res?.ok) {
        throw new Error(`HTTP ${res?.status}`);
      }

      html = await res.text();
    } catch (error) {
      return NextResponse.json(
        {
          error: `Could not fetch that URL: ${
            error instanceof Error ? error.message : "network error"
          }`,
        },
        { status: 422 }
      );
    }

    const structuredRecipe = pickBestStructuredRecipe(
      extractRecipeCandidatesFromJsonLd(html)
    );
    const pageTitle = extractPageTitle(html);
    const pageText = stripHtml(html).slice(0, structuredRecipe ? 9000 : 15000);
    const structuredRecipeText = structuredRecipe
      ? JSON.stringify(
          {
            name: structuredRecipe.name,
            ingredients: structuredRecipe.ingredients.slice(0, 80),
            steps: structuredRecipe.steps.slice(0, 40),
          },
          null,
          2
        )
      : "None found";

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Extract the recipe from this webpage. Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:

{
  "name": "recipe name",
  "ingredients": [
    {
      "name": "ingredient name (lowercase, preserving descriptors and prep details)",
      "quantity": "numeric amount as string, or 'to taste'",
      "unit": "unit of measurement or empty string",
      "section": "one of: Produce | Meat & Seafood | Dairy & Eggs | Bakery | Pantry & Dry Goods | Frozen Foods | Beverages | Snacks | Condiments & Sauces | Spices & Baking | Deli | Other"
    }
  ],
  "steps": [
    "...",
    "..."
  ]
}

Important rules:
- Use the structured recipe data as the primary source when it is present. Use page text only to fill gaps.
- Preserve ingredient wording precisely. Do not drop prep, form, state, reserved/divided, serving, or alternative details such as "diced", "minced", "softened", "melted", "room temperature", "divided", "plus more for serving", or "grapeseed or coconut oil".
- Keep those details in the ingredient "name" field when they are not part of quantity or unit.
- Do not reduce ingredients to generic base nouns. For example, keep "yellow onion, diced" rather than "onion".
- Keep ingredient names lowercase.
- Use the most specific recipe title available and exclude site branding.

If you cannot find a recipe, return: {"error": "No recipe found on this page"}

Page title:
${pageTitle || "None found"}

Structured recipe data:
${structuredRecipeText}

Fallback webpage text:
${pageText}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock ? textBlock.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse recipe from page" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    const resolvedName =
      (typeof parsed.name === "string" && parsed.name.trim()) ||
      structuredRecipe?.name ||
      pageTitle;

    return NextResponse.json({
      ...parsed,
      name: resolvedName || "",
      steps: normalizeRecipeSteps(parsed.steps || []),
    });
  } catch (error) {
    console.error("Import recipe error:", error);
    return NextResponse.json(
      { error: "Failed to import recipe" },
      { status: 500 }
    );
  }
}
