import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

interface StepIngredientInput {
  id: string;
  name: string;
  quantity?: string;
  unit?: string;
}

const client = new Anthropic();

function isValidIngredient(input: unknown): input is StepIngredientInput {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<StepIngredientInput>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0
  );
}

export async function POST(request: NextRequest) {
  try {
    const { ingredients, steps } = await request.json();

    if (!Array.isArray(ingredients) || !Array.isArray(steps)) {
      return NextResponse.json(
        { error: "Expected arrays: ingredients and steps" },
        { status: 400 }
      );
    }

    const parsedIngredients = ingredients.filter(isValidIngredient);
    const parsedSteps = steps.filter((step: unknown) => typeof step === "string");

    if (parsedIngredients.length === 0 || parsedSteps.length === 0) {
      return NextResponse.json({ firstStepByIngredientId: {} });
    }

    const stepCount = parsedSteps.length;
    const ingredientIds = new Set(parsedIngredients.map((ingredient) => ingredient.id));

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Map ingredients to the FIRST recipe step where each ingredient is needed (prepared, added, mixed, cooked, or garnished).

Ingredients:
${JSON.stringify(parsedIngredients, null, 2)}

Steps:
${parsedSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}

Rules:
- Include every ingredient exactly once.
- firstStep must be an integer from 1 to ${stepCount}, or null if the ingredient is truly unused.
- Infer from context when a step uses generic phrases like "season", "spices", "sauce ingredients", "remaining ingredients", etc.
- Choose the earliest step where the ingredient becomes relevant.

Return ONLY valid JSON in this exact format:
{
  "mappings": [
    { "ingredientId": "id", "firstStep": 1 }
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
        { error: "Could not parse step ingredient mapping" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      mappings?: Array<{ ingredientId?: unknown; firstStep?: unknown }>;
    };

    const firstStepByIngredientId: Record<string, number> = {};

    if (Array.isArray(parsed.mappings)) {
      for (const mapping of parsed.mappings) {
        if (!mapping || typeof mapping !== "object") continue;
        if (typeof mapping.ingredientId !== "string") continue;
        if (!ingredientIds.has(mapping.ingredientId)) continue;

        if (typeof mapping.firstStep === "number") {
          const step = Math.floor(mapping.firstStep);
          if (step >= 1 && step <= stepCount) {
            firstStepByIngredientId[mapping.ingredientId] = step - 1;
          }
        }
      }
    }

    return NextResponse.json({ firstStepByIngredientId });
  } catch (error) {
    console.error("Map step ingredients error:", error);
    return NextResponse.json(
      { error: "Failed to map ingredients to steps" },
      { status: 500 }
    );
  }
}
