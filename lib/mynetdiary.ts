import { formatScaledQuantity } from "./recipeSteps";
import { Ingredient, Recipe } from "./types";

export interface MyNetDiaryRecipeExport {
  title: string;
  ingredientsText: string;
  directionsText: string;
  notesText: string;
  fullText: string;
}

function formatIngredientLine(ingredient: Ingredient): string {
  const amount = [ingredient.quantity, ingredient.unit].filter(Boolean).join(" ").trim();
  return [amount, ingredient.name].filter(Boolean).join(" ").trim();
}

export function buildMyNetDiaryRecipeExport(
  recipe: Recipe
): MyNetDiaryRecipeExport {
  const servingsText =
    recipe.servingsYielded && recipe.servingsYielded > 0
      ? `Servings yielded: ${formatScaledQuantity(recipe.servingsYielded)}`
      : "";
  const ingredientsText = recipe.ingredients
    .map((ingredient) => formatIngredientLine(ingredient))
    .filter(Boolean)
    .join("\n");
  const directionsText = recipe.steps
    .map((step, index) => `${index + 1}. ${step.trim()}`)
    .join("\n");
  const notesText = recipe.notes.trim();

  const sections = [recipe.name];
  if (servingsText) sections.push(servingsText);
  if (ingredientsText) sections.push(`Ingredients\n${ingredientsText}`);
  if (directionsText) sections.push(`Directions\n${directionsText}`);
  if (notesText) sections.push(`Notes\n${notesText}`);

  return {
    title: recipe.name,
    ingredientsText,
    directionsText,
    notesText,
    fullText: sections.join("\n\n").trim(),
  };
}
