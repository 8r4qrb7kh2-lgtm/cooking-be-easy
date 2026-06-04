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
 * Deterministically compute the cost of a recipe ingredient's quantity from a
 * matched receipt line. The math is: derive a price-per-unit (per count, or
 * per gram once both sides are expressed in grams via the unit-conversion
 * system), then multiply by the recipe's quantity. Returns null when the
 * amounts cannot be reconciled reliably, so the caller can fall back.
 */
export async function priceIngredientFromReceiptItem(
  ingredient: Ingredient,
  item: ReceiptItem
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

  return null;
}
