import { saveRecipe, setWeeklyPlanIds, saveShoppingList } from "./storage";
import { AppState } from "./types";

const OLD_STORAGE_KEY = "meal-maker-state";
const MIGRATED_KEY = "meal-maker-migrated";

export async function migrateLocalStorageToSupabase(): Promise<void> {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATED_KEY)) return;

  const raw = localStorage.getItem(OLD_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(MIGRATED_KEY, "true");
    return;
  }

  try {
    const state: AppState = JSON.parse(raw);

    // Migrate recipes
    for (const recipe of state.recipes || []) {
      await saveRecipe(recipe);
    }

    // Migrate weekly plan
    if (state.weeklyPlanIds?.length) {
      await setWeeklyPlanIds(state.weeklyPlanIds);
    }

    // Migrate shopping list
    if (state.shoppingList?.length) {
      await saveShoppingList(state.shoppingList);
    }

    localStorage.removeItem(OLD_STORAGE_KEY);
    localStorage.setItem(MIGRATED_KEY, "true");
  } catch (e) {
    console.error("Migration failed:", e);
  }
}
