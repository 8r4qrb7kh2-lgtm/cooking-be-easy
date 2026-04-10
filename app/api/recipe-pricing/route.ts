import { NextRequest, NextResponse } from "next/server";
import { estimateRecipeWithWalmartSearch, PricingRouteError } from "@/lib/openFoodFactsPricing";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const estimate = await estimateRecipeWithWalmartSearch(body);
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
