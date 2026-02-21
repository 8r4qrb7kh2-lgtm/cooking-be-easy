"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Recipe } from "@/lib/types";
import { getRecipes, deleteRecipe } from "@/lib/storage";
import { getRecentRecipeViews, RecentRecipeViews } from "@/lib/recentViews";
import { RecipeSortOption, sortRecipes } from "@/lib/recipeSort";
import { Plus, Trash2, UtensilsCrossed, ImageIcon, Search } from "lucide-react";

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<RecipeSortOption>("recently-viewed");
  const [recentViewsByRecipeId, setRecentViewsByRecipeId] =
    useState<RecentRecipeViews>({});

  useEffect(() => {
    async function load() {
      setRecipes(await getRecipes());
      setRecentViewsByRecipeId(getRecentRecipeViews());
    }

    load();
  }, []);

  async function handleDelete(id: string, name: string) {
    if (confirm(`Delete "${name}"?`)) {
      await deleteRecipe(id);
      setRecipes(await getRecipes());
    }
  }

  const visibleRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const filtered = query
      ? recipes.filter((recipe) => {
          const haystack = `${recipe.name} ${recipe.ingredients
            .map((ingredient) => ingredient.name)
            .join(" ")}`.toLowerCase();
          return haystack.includes(query);
        })
      : recipes;

    return sortRecipes(filtered, sortOption, recentViewsByRecipeId);
  }, [recipes, searchQuery, sortOption, recentViewsByRecipeId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recipe Library</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} saved
            {recipes.length > 0 && ` · showing ${visibleRecipes.length}`}
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

      {recipes.length > 0 && (
        <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipes"
              className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
            />
          </label>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as RecipeSortOption)}
            className="h-10 text-sm px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-label="Sort recipes"
          >
            <option value="recently-viewed">Recently viewed</option>
            <option value="rating-desc">Rating: high to low</option>
          </select>
        </div>
      )}

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
      ) : visibleRecipes.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-500">No matches found</h2>
          <p className="text-sm text-gray-400 mt-1">
            Try a different search term.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {visibleRecipes.map((recipe) => (
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
