import type { Ingredient } from "@/lib/types";

export interface RecipePricingLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  capturedAt: string;
}

export interface RecipePricingRequest {
  recipeName?: string;
  ingredients?: Ingredient[];
  location?: RecipePricingLocation | null;
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
  provider: "mealme";
  estimatedAt: string;
  currencyCode: "USD";
  totalAdjustedPrice: number;
  totalAdjustedPriceText: string;
  resolvedIngredientCount: number;
  unresolvedIngredientCount: number;
  ingredients: IngredientPriceEstimate[];
}
