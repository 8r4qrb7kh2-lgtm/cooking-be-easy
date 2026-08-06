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

export interface RecipeRating {
  recipeId: string;
  userId: string;
  userName: string | null;
  rating: number; // 1-5 stars
}

export interface RecipeCookTime {
  recipeId: string;
  userId: string;
  userName: string | null;
  minutes: number; // how long this person says the dish takes
}

export interface CookLogEntry {
  id: string;
  recipeId: string;
  userId: string;
  cookedOn: string; // YYYY-MM-DD (local calendar date the dish was made)
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  sourceSteps: string[];
  steps: string[];
  notes: string;
  rating?: number; // cached average of recipe_ratings, kept for list/sort compatibility
  servingsYielded?: number; // actual servings this recipe produced
  dishPhotos: string[]; // base64 data URLs
  ingredientPhoto?: string; // base64 data URL of the original photo
  sourceUrl?: string; // URL the recipe was imported from
  createdAt: string;
  updatedAt: string;
}

export const MEAL_SLOTS = ["lunch", "dinner"] as const;

export type MealSlot = (typeof MEAL_SLOTS)[number];

export interface MealPlanEntry {
  id: string;
  recipeId: string;
  planDate: string; // YYYY-MM-DD (local calendar date)
  slot: MealSlot;
  isLeftovers: boolean; // filled with an earlier meal's leftovers, not cooked fresh
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

export interface ReceiptItem {
  id: string;
  receiptId: string;
  rawLabel: string;
  normalizedName: string;
  brand?: string;
  section?: GrocerySection;
  quantity?: number;
  unit?: string;
  packageSizeText?: string;
  unitPrice?: number;
  totalPrice: number;
  currencyCode: string;
  purchasedAt?: string;
  storeName?: string;
  confidence?: number;
}

export interface Receipt {
  id: string;
  storeName?: string;
  storeLocation?: string;
  purchaseDate?: string;
  subtotal?: number;
  total?: number;
  currencyCode: string;
  imageBase64?: string;
  createdAt: string;
  updatedAt: string;
  items: ReceiptItem[];
}
