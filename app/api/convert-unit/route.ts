import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { ingredientName, quantity, fromUnit, toUnit } = await request.json();

    if (!ingredientName || !quantity || !fromUnit || !toUnit) {
      return NextResponse.json(
        { error: "Missing required fields: ingredientName, quantity, fromUnit, toUnit" },
        { status: 400 }
      );
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      thinking: {
        type: "enabled",
        budget_tokens: 1024,
      },
      messages: [
        {
          role: "user",
          content: `Convert this cooking measurement. Return ONLY a valid JSON object (no markdown, no explanation).

Convert: ${quantity} ${fromUnit} of "${ingredientName}" to ${toUnit}

Important:
- Highest priority: physical accuracy of the conversion, especially density.
- If converting between volume and mass (e.g., cups to grams), you MUST use a real-world culinary density for "${ingredientName}" specifically, and for the ingredient's form/state if present in the name (e.g., grated, shredded, chopped, packed, sifted, melted, fresh).
- Do NOT use a generic/default density from a different ingredient. Never substitute flour/sugar/butter-style defaults unless the ingredient is actually that ingredient.
- Use only density values you are confident are realistic for this ingredient in normal cooking contexts.
- If details are missing, infer the most common culinary form for "${ingredientName}" and use a realistic density for that form.
- Ensure the final number is internally consistent with that density and the unit definitions.
- Round to a reasonable precision for cooking (no more than 2 decimal places).
- Support all common cooking units: tsp, tbsp, cup, fl oz, mL, L, pint, quart, gallon, g, kg, oz, lb.

Return format:
{
  "convertedQuantity": "number as string",
  "fromUnit": "${fromUnit}",
  "toUnit": "${toUnit}"
}`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const text = textBlock ? textBlock.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse conversion result" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Unit conversion error:", error);
    return NextResponse.json(
      { error: "Failed to convert unit" },
      { status: 500 }
    );
  }
}
