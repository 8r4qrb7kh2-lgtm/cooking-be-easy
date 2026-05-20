import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a grocery-receipt parser. Given a photo of a receipt, extract every purchased line item into structured JSON.

Grocery receipts are cryptic — expect abbreviations, brand prefixes, and store-specific codes. You must translate these into clean, searchable grocery product names.

Examples of translations:
- "365WFM OG BABY SPIN CLAM" → normalizedName "organic baby spinach", brand "365 Whole Foods Market" (OG = organic, CLAM = clamshell)
- "SANJ TAMARI SAUCE" → normalizedName "tamari sauce", brand "San-J"
- "B&J CHERRY GARCIA" → normalizedName "cherry garcia ice cream", brand "Ben & Jerry's"
- "BCPOP KETTLECORN" → normalizedName "kettle corn", brand "Boomchickapop"
- "RISEB OG NITRO COLD BREW" → normalizedName "nitro cold brew coffee", brand "Rise Brewing Co"
- "365WFM BBY BELLA MUSHROOM" → normalizedName "baby bella mushrooms", brand "365 Whole Foods Market"
- "L39W CHARDONNAY" → normalizedName "chardonnay wine"

Required output per item:
- rawLabel: EXACTLY as printed on the receipt, preserving codes, abbreviations, and spacing
- normalizedName: plain-English lowercase grocery item name you'd search for (no brand)
- brand: real brand name if identifiable, else null
- section: one of "Produce" | "Meat & Seafood" | "Dairy & Eggs" | "Bakery" | "Pantry & Dry Goods" | "Frozen Foods" | "Beverages" | "Snacks" | "Condiments & Sauces" | "Spices & Baking" | "Deli" | "Other"
- quantity: number if the receipt shows count (e.g. "Qty 2"), weight (e.g. "3.27 lb"), or volume. Null if not specified.
- unit: matching unit ("count", "lb", "oz", "fl oz", "each", etc.). Null if quantity is null.
- packageSizeText: short human description of the package if inferable from name (e.g. "13.5 oz can", "1 bunch", "16 oz bag"). Else null.
- unitPrice: per-unit price if shown (e.g. "$1.69/lb", "$3.39 ea"). Else null.
- totalPrice: line-item total in dollars. This is the ACTUAL PAID price after any "Savings with Prime" discounts shown on that line. If both regular and savings are shown, return the discounted total.
- confidence: 0.0 to 1.0, how confident you are the translation is correct.

Rules:
- If the receipt shows "Reg $4.29 / Savings with Prime ($1.04)" and total "$3.25", return totalPrice 3.25 (the actual paid).
- Per-pound items: quantity is the weight, unit is "lb", totalPrice is the total for that weight, unitPrice is per-pound.
- Per-count items with "Qty 2 $3.39 ea": quantity 2, unit "count", unitPrice 3.39, totalPrice 6.78.
- Skip tax, subtotal, savings-summary, loyalty, tender, and footer lines — those are receipt metadata, not items.
- Always return USD values with at most 2 decimal places.

Also extract receipt-level metadata:
- storeName: friendly store name ("Whole Foods Market", "Kroger", "Safeway")
- storeLocation: short address or neighborhood if visible
- purchaseDate: ISO date like "2026-04-23" if visible. Null otherwise.
- subtotal: receipt subtotal before tax, or null
- total: final paid total after tax, or null

Output ONLY valid JSON (no markdown fences, no prose):
{
  "storeName": "...",
  "storeLocation": "...",
  "purchaseDate": "YYYY-MM-DD",
  "subtotal": 87.69,
  "total": 78.69,
  "items": [ { ... }, ... ]
}`;

export async function POST(request: NextRequest) {
  try {
    const { imageBase64 } = await request.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const mediaTypeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mediaType = (mediaTypeMatch?.[1] ?? "image/jpeg") as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text:
                "Extract every purchased line item from this grocery receipt and return the structured JSON described in the system prompt. Do not skip any items.",
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse receipt contents from image" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      storeName: typeof parsed.storeName === "string" ? parsed.storeName : null,
      storeLocation: typeof parsed.storeLocation === "string" ? parsed.storeLocation : null,
      purchaseDate: typeof parsed.purchaseDate === "string" ? parsed.purchaseDate : null,
      subtotal: typeof parsed.subtotal === "number" ? parsed.subtotal : null,
      total: typeof parsed.total === "number" ? parsed.total : null,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    });
  } catch (error) {
    console.error("Extract receipt error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to extract receipt",
      },
      { status: 500 }
    );
  }
}
