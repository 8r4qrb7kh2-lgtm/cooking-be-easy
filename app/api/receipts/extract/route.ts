import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a grocery-receipt parser. Given a photo of a receipt, extract every purchased line item into structured JSON.

CRITICAL: Do not fabricate items. If a line is too blurry, cut off, glare-blocked, or otherwise illegible to confidently read its name and price, do NOT guess. Instead, add a short note to unreadableNotes describing what you can tell about it (position, partial text, suspected category) so the user can manually enter it. If the whole receipt is unreadable, return empty items and a single note explaining why (e.g. "Photo is too blurry to read any items — please retake in better light").

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

Call the submit_receipt tool with every line item you can read confidently, plus an unreadableNotes array listing anything you saw but could not confidently parse. Never invent values to fill the schema.`;

const SECTION_VALUES = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Bakery",
  "Pantry & Dry Goods",
  "Frozen Foods",
  "Beverages",
  "Snacks",
  "Condiments & Sauces",
  "Spices & Baking",
  "Deli",
  "Other",
];

const RECEIPT_TOOL: Anthropic.Tool = {
  name: "submit_receipt",
  description:
    "Submit the parsed grocery receipt with every line item you can read confidently, and unreadableNotes for any items you saw but could not parse",
  input_schema: {
    type: "object",
    properties: {
      storeName: { type: "string", description: "Friendly store name, or empty if not visible" },
      storeLocation: { type: "string", description: "Address or neighborhood, or empty" },
      purchaseDate: { type: "string", description: "ISO YYYY-MM-DD if visible, else empty" },
      subtotal: { type: "number", description: "Subtotal before tax, 0 if not visible" },
      total: { type: "number", description: "Final paid total, 0 if not visible" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rawLabel: { type: "string" },
            normalizedName: { type: "string" },
            brand: { type: "string", description: "Brand name if identifiable, else empty" },
            section: { type: "string", enum: SECTION_VALUES },
            quantity: { type: "number", description: "0 if not specified" },
            unit: { type: "string", description: "Empty if quantity is unknown" },
            packageSizeText: { type: "string", description: "Empty if not inferable" },
            unitPrice: { type: "number", description: "0 if not shown" },
            totalPrice: { type: "number" },
            confidence: { type: "number", description: "0.0 to 1.0" },
          },
          required: [
            "rawLabel",
            "normalizedName",
            "section",
            "totalPrice",
            "confidence",
          ],
        },
      },
      unreadableNotes: {
        type: "array",
        items: { type: "string" },
        description:
          "Short notes about line items visible on the receipt that you could not confidently read. One entry per unreadable item (or one entry for a wholly unreadable receipt). Empty array if every visible item was read confidently.",
      },
    },
    required: ["items", "unreadableNotes"],
  },
};

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
      model: "claude-opus-4-7",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [RECEIPT_TOOL],
      tool_choice: { type: "tool", name: "submit_receipt" },
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
                "Extract every purchased line item from this grocery receipt and call submit_receipt with the structured data. For any item you can see on the receipt but cannot confidently read, add a short description to unreadableNotes instead of guessing. Do not invent values.",
            },
          ],
        },
      ],
    });

    const toolUseBlock = message.content.find((block) => block.type === "tool_use");
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      return NextResponse.json(
        { error: "Could not parse receipt contents from image" },
        { status: 422 }
      );
    }

    const parsed = toolUseBlock.input as {
      storeName?: string;
      storeLocation?: string;
      purchaseDate?: string;
      subtotal?: number;
      total?: number;
      items?: Record<string, unknown>[];
      unreadableNotes?: unknown[];
    };

    const emptyToNull = (s: unknown) =>
      typeof s === "string" && s.trim() ? s : null;
    const zeroToNull = (n: unknown) =>
      typeof n === "number" && n > 0 ? n : null;

    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((item) => ({
      rawLabel: typeof item.rawLabel === "string" ? item.rawLabel : "",
      normalizedName: typeof item.normalizedName === "string" ? item.normalizedName : "",
      brand: emptyToNull(item.brand),
      section: typeof item.section === "string" ? item.section : "Other",
      quantity: zeroToNull(item.quantity),
      unit: emptyToNull(item.unit),
      packageSizeText: emptyToNull(item.packageSizeText),
      unitPrice: zeroToNull(item.unitPrice),
      totalPrice: typeof item.totalPrice === "number" ? item.totalPrice : 0,
      confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
    }));

    const unreadableNotes = (Array.isArray(parsed.unreadableNotes)
      ? parsed.unreadableNotes
      : []
    )
      .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      .map((note) => note.trim());

    return NextResponse.json({
      storeName: emptyToNull(parsed.storeName),
      storeLocation: emptyToNull(parsed.storeLocation),
      purchaseDate: emptyToNull(parsed.purchaseDate),
      subtotal: zeroToNull(parsed.subtotal),
      total: zeroToNull(parsed.total),
      items,
      unreadableNotes,
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
