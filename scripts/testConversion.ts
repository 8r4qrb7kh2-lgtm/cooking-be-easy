// Focused, offline test of the unit-conversion + receipt-pricing math.
// Uses only built-in densities/count weights (no USDA/Claude network calls).
//   npx tsx scripts/testConversion.ts
import {
  convertIngredientQuantity,
  convertMeasureToGrams,
} from "../lib/unitConversion";
import { priceIngredientFromReceiptItem } from "../lib/receiptPricing";
import type { Ingredient, ReceiptItem } from "../lib/types";

let failures = 0;

function approx(label: string, actual: number, expected: number, tolerance = 0.05) {
  const within = Math.abs(actual - expected) <= Math.abs(expected) * tolerance + 0.01;
  console.log(
    `${within ? "✓" : "✗"} ${label}: got ${actual.toFixed(2)}, expected ~${expected.toFixed(2)}`
  );
  if (!within) failures += 1;
}

async function run() {
  // 1. Volume -> mass via built-in density (flour 0.53 g/mL).
  const flour = await convertIngredientQuantity({
    ingredientName: "all-purpose flour",
    quantity: "1",
    fromUnit: "cup",
    toUnit: "g",
  });
  approx("1 cup flour -> g", flour.averageValue, 236.59 * 0.53);

  // 2. Volume -> mass for oil (0.92 g/mL).
  const oil = await convertIngredientQuantity({
    ingredientName: "olive oil",
    quantity: "2",
    fromUnit: "tbsp",
    toUnit: "g",
  });
  approx("2 tbsp oil -> g", oil.averageValue, 2 * 14.7868 * 0.92);

  // 3. Mass -> volume (honey 1.42 g/mL): 100 g honey -> ~70.4 mL.
  const honey = await convertIngredientQuantity({
    ingredientName: "honey",
    quantity: "100",
    fromUnit: "g",
    toUnit: "ml",
  });
  approx("100 g honey -> ml", honey.averageValue, 100 / 1.42);

  // 4. Same-category conversion still exact (no density needed).
  const water = await convertIngredientQuantity({
    ingredientName: "water",
    quantity: "2",
    fromUnit: "cup",
    toUnit: "ml",
  });
  approx("2 cup -> ml", water.averageValue, 2 * 236.5882365);

  // 5. Count -> grams via reference table (garlic clove 5 g).
  const garlic = await convertMeasureToGrams({
    ingredientName: "garlic",
    quantity: 4,
    unit: "cloves",
  });
  approx("4 cloves garlic -> g", garlic?.grams ?? NaN, 20);

  // --- Receipt pricing ---

  // 6. Count ratio: 2 eggs out of a 12-count carton at $3.99.
  const eggItem: ReceiptItem = {
    id: "r-eggs",
    receiptId: "rcpt",
    rawLabel: "EGGS LARGE 12CT",
    normalizedName: "large eggs",
    quantity: 12,
    unit: "count",
    totalPrice: 3.99,
    currencyCode: "USD",
    storeName: "Kroger",
    purchasedAt: "2026-05-01",
  };
  const eggIng: Ingredient = {
    id: "i-eggs",
    name: "eggs",
    quantity: "2",
    unit: "",
    section: "Dairy & Eggs",
  };
  const eggPrice = await priceIngredientFromReceiptItem(eggIng, eggItem);
  approx("2 eggs from 12ct $3.99", eggPrice?.adjustedPrice ?? NaN, (3.99 / 12) * 2);

  // 7. Mass scaling: 1 lb chicken from a 3.27 lb / $5.53 line.
  const chickenItem: ReceiptItem = {
    id: "r-chx",
    receiptId: "rcpt",
    rawLabel: "CHICKEN BREAST",
    normalizedName: "chicken breast",
    quantity: 3.27,
    unit: "lb",
    totalPrice: 5.53,
    currencyCode: "USD",
    storeName: "Safeway",
    purchasedAt: "2026-05-02",
  };
  const chickenIng: Ingredient = {
    id: "i-chx",
    name: "chicken breast",
    quantity: "1",
    unit: "lb",
    section: "Meat & Seafood",
  };
  const chickenPrice = await priceIngredientFromReceiptItem(chickenIng, chickenItem);
  approx("1 lb chicken from 3.27 lb $5.53", chickenPrice?.adjustedPrice ?? NaN, 5.53 / 3.27);

  // 8. Count package w/ size -> volume recipe amount: 2 tbsp tahini from a 16 oz jar at $5.99.
  const tahiniItem: ReceiptItem = {
    id: "r-tah",
    receiptId: "rcpt",
    rawLabel: "SESAME TAHINI",
    normalizedName: "tahini",
    quantity: 1,
    unit: "jar",
    packageSizeText: "16 oz jar",
    totalPrice: 5.99,
    currencyCode: "USD",
    storeName: "Whole Foods Market",
    purchasedAt: "2026-05-03",
  };
  const tahiniIng: Ingredient = {
    id: "i-tah",
    name: "tahini",
    quantity: "2",
    unit: "tbsp",
    section: "Condiments & Sauces",
  };
  const tahiniPrice = await priceIngredientFromReceiptItem(tahiniIng, tahiniItem);
  // 16 oz = 453.59 g package; 2 tbsp tahini = 2*14.7868*1.05 = 31.05 g
  const expectedTahini = (5.99 / 453.59237) * (2 * 14.7868 * 1.05);
  approx("2 tbsp tahini from 16oz $5.99", tahiniPrice?.adjustedPrice ?? NaN, expectedTahini);
  console.log("   tahini source:", tahiniPrice?.source, "|", tahiniPrice?.explanation);

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
