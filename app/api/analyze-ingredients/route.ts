import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Strip the data URL prefix to get raw base64
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const mediaType = imageBase64.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                data: base64Data,
              },
            },
            {
              type: "text",
              text: `Analyze this image of a recipe or ingredient list. Extract every ingredient mentioned with its quantity and unit of measurement. Also extract any cooking steps/instructions if they are visible in the image.

For each ingredient, categorize it into one of these grocery store sections:
- Produce (fresh fruits, vegetables, herbs)
- Meat & Seafood
- Dairy & Eggs
- Bakery (bread, rolls, pastries)
- Pantry & Dry Goods (pasta, rice, canned goods, oils, vinegar)
- Frozen Foods
- Beverages
- Snacks
- Condiments & Sauces (ketchup, mayo, soy sauce, hot sauce)
- Spices & Baking (spices, flour, sugar, baking powder)
- Deli
- Other

Return ONLY valid JSON (no markdown, no explanation) in exactly this format:
{
  "ingredients": [
    {
      "name": "ingredient name (lowercase)",
      "quantity": "numeric amount as a string, or descriptive like 'to taste'",
      "unit": "unit of measurement or empty string if none",
      "section": "exact section name from the list above"
    }
  ],
  "steps": ["Step 1 instruction", "Step 2 instruction"]
}

If you cannot identify any ingredients, use an empty array for "ingredients".
If you cannot identify any steps/instructions, use an empty array for "steps".`,
            },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";

    // Parse JSON from the response (object with ingredients + steps)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse recipe from image" }, { status: 422 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      ingredients: parsed.ingredients || [],
      steps: parsed.steps || [],
    });
  } catch (error) {
    console.error("Analyze ingredients error:", error);
    return NextResponse.json(
      { error: "Failed to analyze image" },
      { status: 500 }
    );
  }
}
