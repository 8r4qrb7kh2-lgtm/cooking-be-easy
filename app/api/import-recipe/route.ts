import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

function stripHtml(html: string): string {
  // Remove scripts and styles entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Convert block elements to newlines
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&frac12;/g, "½")
    .replace(/&frac14;/g, "¼")
    .replace(/&frac34;/g, "¾");

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "No URL provided" }, { status: 400 });
    }

    // Fetch the page with retry for rate limiting
    let html: string;
    try {
      const fetchHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      };

      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
        res = await fetch(url, {
          headers: fetchHeaders,
          signal: AbortSignal.timeout(15000),
        });
        if (res.status !== 429) break;
      }
      if (!res!.ok) throw new Error(`HTTP ${res!.status}`);
      html = await res!.text();
    } catch (e) {
      return NextResponse.json(
        { error: `Could not fetch that URL: ${e instanceof Error ? e.message : "network error"}` },
        { status: 422 }
      );
    }

    const pageText = stripHtml(html).slice(0, 15000); // cap tokens

    const message = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Extract the recipe from this webpage text. Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:

{
  "name": "recipe name",
  "ingredients": [
    {
      "name": "ingredient name (lowercase)",
      "quantity": "numeric amount as string, or 'to taste'",
      "unit": "unit of measurement or empty string",
      "section": "one of: Produce | Meat & Seafood | Dairy & Eggs | Bakery | Pantry & Dry Goods | Frozen Foods | Beverages | Snacks | Condiments & Sauces | Spices & Baking | Deli | Other"
    }
  ],
  "steps": [
    "Step 1: ...",
    "Step 2: ..."
  ]
}

If you cannot find a recipe, return: {"error": "No recipe found on this page"}

Webpage text:
${pageText}`,
        },
      ],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse recipe from page" },
        { status: 422 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Import recipe error:", error);
    return NextResponse.json(
      { error: "Failed to import recipe" },
      { status: 500 }
    );
  }
}
