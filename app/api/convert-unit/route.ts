import { NextRequest, NextResponse } from "next/server";
import { convertIngredientQuantity } from "@/lib/unitConversion";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { ingredientName, quantity, fromUnit, toUnit } = await request.json();

    if (!ingredientName || !quantity || !fromUnit || !toUnit) {
      return NextResponse.json(
        { error: "Missing required fields: ingredientName, quantity, fromUnit, toUnit" },
        { status: 400 }
      );
    }

    const result = await convertIngredientQuantity({
      ingredientName: String(ingredientName),
      quantity: String(quantity),
      fromUnit: String(fromUnit),
      toUnit: String(toUnit),
    });

    return NextResponse.json({
      convertedQuantity: result.convertedQuantity,
      fromUnit: result.fromUnit,
      toUnit: result.toUnit,
      source: result.source,
    });
  } catch (error) {
    console.error("Unit conversion error:", error);

    const message =
      error instanceof Error ? error.message : "Failed to convert unit";
    const status = /parse quantity|Unsupported unit|reliable density/i.test(message)
      ? 422
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
