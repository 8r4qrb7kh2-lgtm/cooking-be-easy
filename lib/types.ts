export const GROCERY_SECTIONS = [
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
] as const;

export type GrocerySection = (typeof GROCERY_SECTIONS)[number];

export interface Ingredient {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  section: GrocerySection;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  steps: string[];
  rating?: number; // 1-5 stars
  servingsYielded?: number; // actual servings this recipe produced
  dishPhotos: string[]; // base64 data URLs
  ingredientPhoto?: string; // base64 data URL of the original photo
  sourceUrl?: string; // URL the recipe was imported from
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingListItem {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  section: GrocerySection;
  recipeIds: string[];
  recipeNames: string[];
  checked: boolean;
}

export interface AppState {
  recipes: Recipe[];
  weeklyPlanIds: string[];
  shoppingList: ShoppingListItem[];
}
