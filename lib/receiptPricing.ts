import { Ingredient, ReceiptItem } from "@/lib/types";
import { IngredientPriceEstimate } from "@/lib/recipePricing";
import {
  averageQuantityValue,
  convertMeasureToGrams,
  countFamily,
  isCountUnit,
  normalizeExactUnit,
} from "@/lib/unitConversion";

function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatReceiptBasis(item: ReceiptItem): string {
  const parts: string[] = [];
  if (item.storeName) parts.push(item.storeName);
  if (item.purchasedAt) parts.push(item.purchasedAt);
  return parts.join(" ");
}

function describeReceiptLine(item: ReceiptItem): string {
  if (item.quantity && item.unit) {
    return `${formatUsd(item.totalPrice)} for ${item.quantity} ${item.unit}`;
  }
  if (item.packageSizeText) {
    return `${formatUsd(item.totalPrice)} for ${item.packageSizeText}`;
  }
  return `${formatUsd(item.totalPrice)}`;
}

/**
 * Compute the cost of a recipe ingredient's quantity from a matched receipt
 * line. Two strategies, chosen by how the recipe is measured:
 *   - Exact weight/volume ("2 tbsp", "200 g"): deterministic gram math — express
 *     both sides in grams via the unit-conversion system and price by grams.
 *   - Count, including no unit ("4" scallions, "3" cloves): use the model's
 *     receiptFractionForRecipe — the share of the whole receipt line the recipe
 *     uses — because bridging a count↔container mismatch (a few pieces out of a
 *     bunch/head/package) needs the semantic "pieces per container" judgement
 *     that only the model has.
 * Returns null when the amounts cannot be reconciled reliably, so the caller can
 * fall back to a USDA average or a Claude estimate.
 */
export async function priceIngredientFromReceiptItem(
  ingredient: Ingredient,
  item: ReceiptItem,
  options: { receiptFractionForRecipe?: number | null } = {}
): Promise<IngredientPriceEstimate | null> {
  if (!Number.isFinite(item.totalPrice) || item.totalPrice <= 0) return null;

  const recipeValue = averageQuantityValue(ingredient.quantity);
  if (recipeValue === null || recipeValue <= 0) return null;

  const receiptQty = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const receiptUnit = item.unit ?? "";
  const matchTitle = item.normalizedName || ingredient.name;
  const basis = formatReceiptBasis(item);

  const buildEstimate = (params: {
    adjustedPrice: number;
    packagePrice: number;
    confidence: number;
    method: string;
  }): IngredientPriceEstimate => {
    const adjustedPrice = roundToCents(params.adjustedPrice);
    const packagePrice = roundToCents(params.packagePrice);
    const explanation = [
      `From your ${basis || "receipt"}: ${describeReceiptLine(item)}`,
      params.method,
    ]
      .filter(Boolean)
      .join(" — ");

    return {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      adjustedPrice,
      adjustedPriceText: formatUsd(adjustedPrice),
      packagePrice,
      packagePriceText: formatUsd(packagePrice),
      packageSizeText: item.packageSizeText,
      matchTitle,
      matchStore: item.storeName,
      matchUrl: undefined,
      confidence: params.confidence,
      explanation,
      unavailableReason: null,
      source: "receipt",
    };
  };

  // The model estimates what share of the whole receipt line the recipe uses —
  // the only reliable way to bridge a count↔container mismatch (a few
  // scallions/cloves/sheets out of a bunch/head/package). Multiply that share by
  // the price actually paid on the receipt.
  const fraction = options.receiptFractionForRecipe;
  const fractionEstimate = (): IngredientPriceEstimate | null => {
    if (fraction === null || fraction === undefined) return null;
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 100) return null;
    return buildEstimate({
      adjustedPrice: fraction * item.totalPrice,
      packagePrice: item.totalPrice,
      confidence: 0.82,
      method: `recipe uses ≈${Math.round(fraction * 100)}% of this purchase`,
    });
  };

  // Recipe measured by count (incl. no unit): "how many pieces per container" is
  // the dominant question, so prefer the model's share. Recipe measured by an
  // exact weight/volume falls through to the more precise gram math below.
  if (normalizeExactUnit(ingredient.unit) === null) {
    const fromFraction = fractionEstimate();
    if (fromFraction) return fromFraction;
  }

  // Fast path: both sides counted in the same family (eggs, cans, cloves...).
  // Price scales directly by the count ratio with no weight assumptions.
  if (
    isCountUnit(ingredient.unit) &&
    isCountUnit(receiptUnit) &&
    countFamily(ingredient.unit) === countFamily(receiptUnit)
  ) {
    const pricePerUnit = item.totalPrice / receiptQty;
    const unitLabel = receiptUnit || "each";
    return buildEstimate({
      adjustedPrice: pricePerUnit * recipeValue,
      packagePrice: pricePerUnit,
      confidence: 0.92,
      method: `${formatUsd(pricePerUnit)} per ${unitLabel} x ${recipeValue}`,
    });
  }

  // General path: express both the receipt line and the recipe amount in grams,
  // then price by grams. convertMeasureToGrams handles mass directly, volume via
  // ingredient density, and counts via package size or reference weights.
  const receiptExact = normalizeExactUnit(receiptUnit);
  const receiptMeasure =
    receiptExact && receiptQty > 0
      ? { quantity: receiptQty, unit: receiptUnit, packageSizeText: undefined as string | undefined }
      : { quantity: receiptQty, unit: receiptUnit || "count", packageSizeText: item.packageSizeText };

  const [receiptGrams, recipeGrams] = await Promise.all([
    convertMeasureToGrams({
      ingredientName: matchTitle,
      quantity: receiptMeasure.quantity,
      unit: receiptMeasure.unit,
      packageSizeText: receiptMeasure.packageSizeText,
    }),
    convertMeasureToGrams({
      ingredientName: ingredient.name,
      quantity: recipeValue,
      unit: ingredient.unit,
    }),
  ]);

  if (receiptGrams && recipeGrams && receiptGrams.grams > 0 && recipeGrams.grams > 0) {
    const pricePerGram = item.totalPrice / receiptGrams.grams;
    const usedReferenceWeight =
      receiptGrams.source === "count weight" || recipeGrams.source === "count weight";
    return buildEstimate({
      adjustedPrice: pricePerGram * recipeGrams.grams,
      packagePrice: item.totalPrice,
      confidence: usedReferenceWeight ? 0.78 : 0.88,
      method: `${formatUsd(pricePerGram * 100)}/100g x ${Math.round(recipeGrams.grams)}g`,
    });
  }

  // Exact-measure recipe the gram math couldn't reconcile (e.g. an unusual
  // receipt unit): fall back to the model's share of the line if it gave one.
  return fractionEstimate();
}
