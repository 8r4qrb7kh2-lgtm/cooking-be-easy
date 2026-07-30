import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new Anthropic();

const MAX_LABEL_LENGTH = 48;

/** Trims an over-long label back to a clause or word boundary, never mid-word. */
function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;

  const head = label.slice(0, MAX_LABEL_LENGTH);
  const lastClause = head.lastIndexOf(",");
  if (lastClause > MAX_LABEL_LENGTH / 3) return head.slice(0, lastClause);

  const lastWord = head.lastIndexOf(" ");
  return (lastWord > 0 ? head.slice(0, lastWord) : head).replace(/[.;:,]+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const { steps, ingredients } = await request.json();

    if (!Array.isArray(steps)) {
      return NextResponse.json(
        { error: "Expected an array: steps" },
        { status: 400 }
      );
    }

    const parsedSteps = steps.filter(
      (step: unknown): step is string =>
        typeof step === "string" && step.trim().length > 0
    );

    if (parsedSteps.length === 0) {
      return NextResponse.json({ labelByStep: {} });
    }

    const ingredientNames = Array.isArray(ingredients)
      ? ingredients
          .map((ingredient: unknown) =>
            ingredient && typeof ingredient === "object"
              ? (ingredient as { name?: unknown }).name
              : null
          )
          .filter(
            (name: unknown): name is string =>
              typeof name === "string" && name.trim().length > 0
          )
      : [];

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Condense each recipe step into the terse operation label used by a recipe matrix (the Cooking for Engineers table format), where ingredients sit in rows and each operation is a narrow column cell.

Steps:
${parsedSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}
${
  ingredientNames.length > 0
    ? `\nIngredients already listed in the table rows:\n${ingredientNames
        .map((name) => `- ${name}`)
        .join("\n")}`
    : ""
}

Rules:
- One label per step, in order, for all ${parsedSteps.length} steps.
- Use the imperative verb for the operation: "melt", "mix", "fold in", "whisk", "sauté".
- Lowercase, no trailing punctuation, at most 6 words.
- Do NOT repeat ingredient names — they are already in the table rows.
- Append the temperature and/or time when the step states one, e.g. "bake 350°F (170°C) 30 to 40 min", "simmer 20 min".
- Keep setup steps literal but short, e.g. "preheat oven 350°F (170°C)".

Return ONLY valid JSON in this exact format:
{
  "operations": [
    { "step": 1, "label": "melt" }
  ]
}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock ? textBlock.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse recipe table labels" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      operations?: Array<{ step?: unknown; label?: unknown }>;
    };

    const labelByStep: Record<string, string> = {};

    if (Array.isArray(parsed.operations)) {
      for (const operation of parsed.operations) {
        if (!operation || typeof operation !== "object") continue;
        if (typeof operation.step !== "number") continue;
        if (typeof operation.label !== "string") continue;

        const stepIndex = Math.floor(operation.step) - 1;
        if (stepIndex < 0 || stepIndex >= parsedSteps.length) continue;

        const label = operation.label
          .replace(/\s+/g, " ")
          .replace(/[.;:,]+$/, "")
          .trim();
        if (!label) continue;

        labelByStep[String(stepIndex)] = truncateLabel(label);
      }
    }

    return NextResponse.json({ labelByStep });
  } catch (error) {
    console.error("Recipe table labels error:", error);
    return NextResponse.json(
      { error: "Failed to build recipe table labels" },
      { status: 500 }
    );
  }
}
