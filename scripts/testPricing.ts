// Ad-hoc test for the new grocery pricing engine. Run with:
//   npx tsx scripts/testPricing.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { Ingredient } from "../lib/types";

// Load env from .env.local BEFORE importing modules that read process.env at init time.
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

console.log(
  "ANTHROPIC_API_KEY present:",
  Boolean(process.env.ANTHROPIC_API_KEY?.trim())
);

// Sample recipe based on the Spicy Coconut Ramen with Roasted King Oyster dish (24 ingredients)
const SAMPLE_INGREDIENTS: Ingredient[] = [
  { id: "1",  name: "king oyster mushrooms",       quantity: "1",   unit: "lb",    section: "Produce" },
  { id: "2",  name: "ramen noodles",               quantity: "8",   unit: "oz",    section: "Pantry & Dry Goods" },
  { id: "3",  name: "full-fat coconut milk",       quantity: "1",   unit: "can",   section: "Pantry & Dry Goods" },
  { id: "4",  name: "vegetable broth",             quantity: "3",   unit: "cups",  section: "Pantry & Dry Goods" },
  { id: "5",  name: "red curry paste",             quantity: "2",   unit: "tbsp",  section: "Condiments & Sauces" },
  { id: "6",  name: "gochujang",                   quantity: "1",   unit: "tbsp",  section: "Condiments & Sauces" },
  { id: "7",  name: "soy sauce",                   quantity: "2",   unit: "tbsp",  section: "Condiments & Sauces" },
  { id: "8",  name: "fish sauce",                  quantity: "1",   unit: "tsp",   section: "Condiments & Sauces" },
  { id: "9",  name: "lime juice",                  quantity: "2",   unit: "tbsp",  section: "Produce" },
  { id: "10", name: "ginger, minced",              quantity: "1",   unit: "tbsp",  section: "Produce" },
  { id: "11", name: "garlic cloves, minced",       quantity: "4",   unit: "cloves",section: "Produce" },
  { id: "12", name: "shallot, thinly sliced",      quantity: "1",   unit: "",      section: "Produce" },
  { id: "13", name: "scallions",                   quantity: "3",   unit: "",      section: "Produce" },
  { id: "14", name: "cilantro leaves",             quantity: "1/4", unit: "cup",   section: "Produce" },
  { id: "15", name: "toasted sesame seeds",        quantity: "1",   unit: "tbsp",  section: "Spices & Baking" },
  { id: "16", name: "neutral oil",                 quantity: "3",   unit: "tbsp",  section: "Pantry & Dry Goods" },
  { id: "17", name: "sesame oil",                  quantity: "1",   unit: "tsp",   section: "Condiments & Sauces" },
  { id: "18", name: "brown sugar",                 quantity: "1",   unit: "tsp",   section: "Spices & Baking" },
  { id: "19", name: "salt",                        quantity: "1/2", unit: "tsp",   section: "Spices & Baking" },
  { id: "20", name: "black pepper",                quantity: "1/4", unit: "tsp",   section: "Spices & Baking" },
  { id: "21", name: "red pepper flakes",           quantity: "1",   unit: "tsp",   section: "Spices & Baking" },
  { id: "22", name: "baby bok choy",               quantity: "2",   unit: "heads", section: "Produce" },
  { id: "23", name: "soft-boiled eggs",            quantity: "2",   unit: "",      section: "Dairy & Eggs" },
  { id: "24", name: "chili crisp for serving",     quantity: "2",   unit: "tbsp",  section: "Condiments & Sauces" },
];

async function main() {
  // Dynamic import to ensure env vars are set before the module init that reads them.
  const { estimateRecipeWithWalmartSearch } = await import(
    "../lib/openFoodFactsPricing"
  );

  const started = Date.now();
  const result = await estimateRecipeWithWalmartSearch({
    recipeName: "Spicy Coconut Ramen with Roasted King Oyster",
    ingredients: SAMPLE_INGREDIENTS,
  });
  const durationMs = Date.now() - started;

  console.log("---");
  console.log(`Provider: ${result.provider}`);
  console.log(`Total: ${result.totalAdjustedPriceText}`);
  console.log(
    `Resolved: ${result.resolvedIngredientCount}/${SAMPLE_INGREDIENTS.length} ingredients`
  );
  console.log(`Unresolved: ${result.unresolvedIngredientCount}`);
  console.log(`Took: ${durationMs}ms`);
  console.log("---");

  for (const est of result.ingredients) {
    const price = est.adjustedPriceText ?? "(unavailable)";
    const pkg = est.packagePriceText ? ` (pkg ${est.packagePriceText})` : "";
    const size = est.packageSizeText ? ` @ ${est.packageSizeText}` : "";
    const match = est.matchTitle ? ` [${est.matchTitle}]` : "";
    console.log(
      `${price.padEnd(10)} ${est.quantity} ${est.unit} ${est.ingredientName}${size}${pkg}${match}`
    );
    if (est.adjustedPrice === null && est.unavailableReason) {
      console.log(`           ! ${est.unavailableReason}`);
    }
  }
}

main().catch((error) => {
  console.error("Pricing test failed:", error);
  process.exit(1);
});
