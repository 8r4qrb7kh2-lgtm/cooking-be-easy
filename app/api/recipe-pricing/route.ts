import { NextRequest, NextResponse } from "next/server";
import { estimateRecipeWithSpoonacular, PricingRouteError } from "@/lib/spoonacularPricing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const estimate = await estimateRecipeWithSpoonacular(body);
    return NextResponse.json(estimate);
  } catch (error) {
    console.error("Recipe pricing error:", error);

    if (error instanceof PricingRouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to estimate grocery ingredient prices.",
      },
      { status: 500 }
    );
  }
}
