"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Recipe } from "@/lib/types";
import { getRecipes, deleteRecipe } from "@/lib/storage";
import { Plus, Trash2, UtensilsCrossed, ImageIcon } from "lucide-react";

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);

  useEffect(() => {
    getRecipes().then(setRecipes);
  }, []);

  async function handleDelete(id: string, name: string) {
    if (confirm(`Delete "${name}"?`)) {
      await deleteRecipe(id);
      setRecipes(await getRecipes());
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipe Library</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} saved
          </p>
        </div>
        <Link
          href="/recipes/new"
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={18} />
          New
        </Link>
      </div>

      {recipes.length === 0 ? (
        <div className="text-center py-20">
          <UtensilsCrossed size={48} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-lg font-semibold text-gray-500">No recipes yet</h2>
          <p className="text-sm text-gray-400 mt-1 mb-6">
            Add your first recipe by uploading an ingredient list photo
          </p>
          <Link
            href="/recipes/new"
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Add Recipe
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="relative group">
              <Link href={`/recipes/${recipe.id}`} className="block">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                  {/* Photo or placeholder */}
                  <div className="aspect-square bg-gray-100 overflow-hidden">
                    {recipe.dishPhotos.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={recipe.dishPhotos[0]}
                        alt={recipe.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon size={36} className="text-gray-300" />
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 leading-tight">
                      {recipe.name}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {recipe.ingredients.length} ingredients
                      {recipe.dishPhotos.length > 0 &&
                        ` · ${recipe.dishPhotos.length} photo${recipe.dishPhotos.length > 1 ? "s" : ""}`}
                    </p>
                  </div>
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete(recipe.id, recipe.name);
                }}
                className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
