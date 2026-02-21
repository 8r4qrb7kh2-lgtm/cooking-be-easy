"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Recipe } from "@/lib/types";
import { getRecipes } from "@/lib/storage";
import { Flame, ChevronRight } from "lucide-react";

export default function CookSelectPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => {
    getRecipes().then(setRecipes);
  }, []);

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Flame size={22} className="text-brand-600" />
        <h1 className="text-xl font-bold text-gray-900">Cooking Mode</h1>
      </div>

      {recipes.length === 0 ? (
        <div className="text-center py-16">
          <Flame size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">No recipes yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Add recipes first, then come back to cook!
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-4">
            Select a recipe to start cooking step by step.
          </p>
          {recipes
            .filter((r) => r.steps && r.steps.length > 0)
            .map((recipe) => (
              <button
                key={recipe.id}
                onClick={() => router.push(`/cook/${recipe.id}`)}
                className="w-full flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-sm transition-all text-left"
              >
                {recipe.dishPhotos.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={recipe.dishPhotos[0]}
                    alt={recipe.name}
                    className="w-14 h-14 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                    <Flame size={20} className="text-brand-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {recipe.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {recipe.steps.length} steps · {recipe.ingredients.length} ingredients
                  </p>
                </div>
                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </button>
            ))}
          {recipes.filter((r) => r.steps && r.steps.length > 0).length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">
                None of your recipes have cooking steps yet.
              </p>
              <p className="text-gray-400 text-xs mt-1">
                Add steps to a recipe first, then come back to cook!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
