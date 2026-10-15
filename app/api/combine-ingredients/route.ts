import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { GROCERY_SECTIONS, GrocerySection } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface EntryInput {
  name: string;
  quantity: string;
  unit: string;
  section: string;
  recipeName: string;
}

export interface CombinedGroup {
  entryIndexes: number[];
  name: string;
  quantity: string;
  unit: string;
  section: GrocerySection;
}

const client = new Anthropic();

function isValidEntry(input: unknown): input is EntryInput {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<EntryInput>;
  return typeof candidate.name === "string" && candidate.name.trim().length > 0;
}

function asSection(value: unknown, fallback: string): GrocerySection {
  if (typeof value === "string" && (GROCERY_SECTIONS as readonly string[]).includes(value)) {
    return value as GrocerySection;
  }
  return (GROCERY_SECTIONS as readonly string[]).includes(fallback)
    ? (fallback as GrocerySection)
    : "Other";
}

// Takes every ingredient line from the selected recipes and asks Claude which
// lines are the same grocery item, with one combined quantity for each. Every
// entry index ends up in exactly one group; groups of one are untouched lines.
export async function POST(request: NextRequest) {
  try {
    const { entries } = await request.json();

    if (!Array.isArray(entries) || !entries.every(isValidEntry)) {
      return NextResponse.json({ error: "Expected an array of entries" }, { status: 400 });
    }

    if (entries.length === 0) {
      return NextResponse.json({ groups: [] });
    }

    const lines = entries
      .map(
        (entry: EntryInput, index: number) =>
          `${index}. ${[entry.quantity, entry.unit].filter(Boolean).join(" ") || "(no qty)"} | ${entry.name} | recipe: ${entry.recipeName}`
      )
      .join("\n");

    const message = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are building a grocery shopping list from several recipes. Below is every ingredient line from every selected recipe, numbered.

${lines}

Find lines that refer to the same item you would buy at the store and combine them into one shopping list entry with a single combined quantity.

Rules:
- Treat lines as the same item when a shopper would buy one product for both (e.g. "garlic cloves" and "minced garlic"; "yellow onion" and "onion, diced"; "kosher salt" and "salt"). Do NOT merge genuinely different products (e.g. "chicken breast" vs "chicken thighs", "butter" vs "peanut butter", "red bell pepper" vs "green bell pepper").
- Add the quantities together. When units differ, convert to one sensible shopping unit (e.g. 2 tbsp + 1/4 cup butter = 6 tbsp; 1 lb + 8 oz = 1.5 lb). Use common fractions or decimals as appropriate (e.g. "1 1/2", "0.75").
- If quantities can't be meaningfully added (e.g. "to taste", "a pinch", count vs weight with no sensible conversion), give your best practical combined amount in "quantity" and "unit", or express both like "2 + to taste".
- Use a clean, generic grocery name for combined entries (e.g. "Garlic", "Yellow onion").
- Every line number from 0 to ${entries.length - 1} must appear in exactly one group. Lines with no duplicate go in their own single-line group with their original name, quantity and unit.
- section must be one of: ${GROCERY_SECTIONS.join(", ")}.

Return ONLY valid JSON in this exact format:
{
  "groups": [
    { "lines": [0, 4], "name": "Garlic", "quantity": "6", "unit": "cloves", "section": "Produce" }
  ]
}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock ? textBlock.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse combined ingredients" }, { status: 422 });
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      groups?: Array<{
        lines?: unknown;
        name?: unknown;
        quantity?: unknown;
        unit?: unknown;
        section?: unknown;
      }>;
    };

    // Validate: drop bad or repeated indexes, and give any line Claude
    // skipped its own group so nothing silently falls off the list.
    const used = new Set<number>();
    const groups: CombinedGroup[] = [];

    for (const group of Array.isArray(parsed.groups) ? parsed.groups : []) {
      if (!group || !Array.isArray(group.lines)) continue;
      const entryIndexes = group.lines.filter(
        (value): value is number =>
          Number.isInteger(value) &&
          (value as number) >= 0 &&
          (value as number) < entries.length &&
          !used.has(value as number)
      );
      if (entryIndexes.length === 0) continue;
      entryIndexes.forEach((index) => used.add(index));

      const first = entries[entryIndexes[0]] as EntryInput;
      // A line with no duplicate keeps exactly what the recipe says.
      if (entryIndexes.length === 1) {
        groups.push({
          entryIndexes,
          name: first.name,
          quantity: first.quantity ?? "",
          unit: first.unit ?? "",
          section: asSection(group.section, first.section),
        });
        continue;
      }
      groups.push({
        entryIndexes,
        name:
          typeof group.name === "string" && group.name.trim() ? group.name.trim() : first.name,
        quantity: typeof group.quantity === "string" ? group.quantity : String(group.quantity ?? ""),
        unit: typeof group.unit === "string" ? group.unit : "",
        section: asSection(group.section, first.section),
      });
    }

    entries.forEach((entry: EntryInput, index: number) => {
      if (used.has(index)) return;
      groups.push({
        entryIndexes: [index],
        name: entry.name,
        quantity: entry.quantity ?? "",
        unit: entry.unit ?? "",
        section: asSection(entry.section, entry.section),
      });
    });

    return NextResponse.json({ groups });
  } catch (error) {
    console.error("Combine ingredients error:", error);
    return NextResponse.json({ error: "Failed to combine ingredients" }, { status: 500 });
  }
}
