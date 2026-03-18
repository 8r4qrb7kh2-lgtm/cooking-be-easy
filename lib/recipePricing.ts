export interface IngredientPriceEstimate {
  ingredientId: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  adjustedPrice: number | null;
  adjustedPriceText: string | null;
  amazonPackagePrice: number | null;
  amazonPackagePriceText: string | null;
  matchTitle?: string;
  matchUrl?: string;
  confidence: number | null;
  explanation?: string;
  unavailableReason?: string | null;
}

export interface RecipePriceEstimate {
  estimatedAt: string;
  currencyCode: "USD";
  totalAdjustedPrice: number;
  totalAdjustedPriceText: string;
  resolvedIngredientCount: number;
  unresolvedIngredientCount: number;
  ingredients: IngredientPriceEstimate[];
}
