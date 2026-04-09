import type { Ingredient } from "@/lib/types";

export interface RecipePricingRequest {
  recipeName?: string;
  ingredients?: Ingredient[];
}

export interface IngredientPriceEstimate {
  ingredientId: string;
  ingredientName: string;
  quantity: string;
  unit: string;
  adjustedPrice: number | null;
  adjustedPriceText: string | null;
  packagePrice: number | null;
  packagePriceText: string | null;
  packageSizeText?: string;
  matchTitle?: string;
  matchStore?: string;
  matchUrl?: string;
  confidence: number | null;
  explanation?: string;
  unavailableReason?: string | null;
}

export interface RecipePriceEstimate {
  provider: "open-food-facts" | "spoonacular";
  estimatedAt: string;
  currencyCode: "USD";
  totalAdjustedPrice: number;
  totalAdjustedPriceText: string;
  resolvedIngredientCount: number;
  unresolvedIngredientCount: number;
  ingredients: IngredientPriceEstimate[];
}
