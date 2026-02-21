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
- If converting between volume and mass (e.g., cups to grams), use the correct density for "${ingredientName}" specifically. Different ingredients have very different densities (e.g., 1 cup of flour ≈ 125g, but 1 cup of sugar ≈ 200g, 1 cup of butter ≈ 227g).
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
