"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Recipe } from "@/lib/types";
import { getRecipes, getWeeklyPlanIds, setWeeklyPlanIds, saveShoppingList } from "@/lib/storage";
import { mergeIngredients } from "@/lib/utils";
import { Check, ImageIcon, ShoppingCart } from "lucide-react";
import Link from "next/link";

export default function PlannerPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      setRecipes(await getRecipes());
      setSelectedIds(await getWeeklyPlanIds());
    }
    load();
  }, []);

  async function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    setSelectedIds(next);
    await setWeeklyPlanIds(next);
  }

  async function buildList() {
    const selected = recipes.filter((r) => selectedIds.includes(r.id));
    const list = mergeIngredients(selected);
    await saveShoppingList(list);
    router.push("/shopping");
  }

  const selectedCount = selectedIds.length;
  const totalIngredients = recipes
    .filter((r) => selectedIds.includes(r.id))
    .reduce((sum, r) => sum + r.ingredients.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Weekly Planner</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Select recipes for this week to generate your shopping list.
      </p>

      {recipes.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">No recipes saved yet.</p>
          <Link
            href="/recipes/new"
            className="inline-block bg-brand-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-brand-700 transition-colors"
          >
            Add a recipe first
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {recipes.map((recipe) => {
              const selected = selectedIds.includes(recipe.id);
              return (
                <button
                  key={recipe.id}
                  onClick={() => toggle(recipe.id)}
                  className={`relative text-left rounded-xl border-2 overflow-hidden transition-all ${
                    selected
                      ? "border-brand-500 shadow-md shadow-brand-100"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {/* Image */}
                  <div className="aspect-square bg-gray-100">
                    {recipe.dishPhotos.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={recipe.dishPhotos[0]}
                        alt={recipe.name}
                        className="w-full h-full object-cover"
                      />
                    ) : recipe.ingredientPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={recipe.ingredientPhoto}
                        alt={recipe.name}
                        className="w-full h-full object-cover opacity-50"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon size={32} className="text-gray-300" />
                      </div>
                    )}
                  </div>

                  {/* Check badge */}
                  {selected && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-brand-600 rounded-full flex items-center justify-center">
                      <Check size={14} className="text-white" />
                    </div>
                  )}

                  <div className="p-2.5">
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">
                      {recipe.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {recipe.ingredients.length} ingredients
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Sticky footer */}
          <div className="fixed bottom-16 left-0 right-0 px-4 pb-2 bg-gradient-to-t from-gray-50 pt-4">
            <div className="max-w-4xl mx-auto">
              <button
                onClick={buildList}
                disabled={selectedCount === 0}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                <ShoppingCart size={20} />
                {selectedCount === 0
                  ? "Select recipes to build list"
                  : `Build list — ${selectedCount} recipe${selectedCount > 1 ? "s" : ""}, ~${totalIngredients} items`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
