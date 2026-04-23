import { NextRequest, NextResponse } from "next/server";
import {
  estimateRecipeWithWalmartSearch,
  PricingRouteError,
} from "@/lib/openFoodFactsPricing";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadReceiptLibraryForUser } from "@/lib/receiptsServer";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Load the caller's receipt library so pricing prefers actual paid prices.
    let receiptLibrary: Awaited<ReturnType<typeof loadReceiptLibraryForUser>> = [];
    try {
      const supabase = await createServerSupabase();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        receiptLibrary = await loadReceiptLibraryForUser(session.user.id);
      }
    } catch (error) {
      // Non-fatal — just degrade to estimate-only pricing.
      console.error("Receipt library lookup failed:", error);
    }

    const estimate = await estimateRecipeWithWalmartSearch(body, { receiptLibrary });
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
