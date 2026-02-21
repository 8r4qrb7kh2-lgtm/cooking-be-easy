"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Recipe } from "@/lib/types";
import { getRecipes } from "@/lib/storage";
import { getRecentRecipeViews, RecentRecipeViews } from "@/lib/recentViews";
import { RecipeSortOption, sortRecipes } from "@/lib/recipeSort";
import { Flame, ChevronRight, Search } from "lucide-react";
import PageLoadingScreen from "@/components/PageLoadingScreen";

export default function CookSelectPage() {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<RecipeSortOption>("recently-viewed");
  const [recentViewsByRecipeId, setRecentViewsByRecipeId] =
    useState<RecentRecipeViews>({});

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const loadedRecipes = await getRecipes();

        if (!mounted) {
          return;
        }

        setRecipes(loadedRecipes);
        setRecentViewsByRecipeId(getRecentRecipeViews());
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const cookableRecipes = useMemo(
    () => recipes.filter((recipe) => recipe.steps && recipe.steps.length > 0),
    [recipes]
  );

  const visibleRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? cookableRecipes.filter((recipe) => {
          const haystack = `${recipe.name} ${recipe.ingredients
            .map((ingredient) => ingredient.name)
            .join(" ")}`.toLowerCase();
          return haystack.includes(query);
        })
      : cookableRecipes;

    return sortRecipes(filtered, sortOption, recentViewsByRecipeId);
  }, [cookableRecipes, recentViewsByRecipeId, searchQuery, sortOption]);

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Flame size={22} className="text-brand-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cooking Mode</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading
              ? "Loading recipes..."
              : `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"} saved${
                  recipes.length > 0 ? ` · showing ${visibleRecipes.length}` : ""
                }`}
          </p>
        </div>
      </div>

      {loading ? (
        <PageLoadingScreen />
      ) : recipes.length === 0 ? (
        <div className="text-center py-16">
          <Flame size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">No recipes yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Add recipes first, then come back to cook!
          </p>
        </div>
      ) : cookableRecipes.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-4">
            Select a recipe to start cooking step by step.
          </p>
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm">
              None of your recipes have cooking steps yet.
            </p>
            <p className="text-gray-400 text-xs mt-1">
              Add steps to a recipe first, then come back to cook!
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-4">
            Select a recipe to start cooking step by step.
          </p>

          <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
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

          {visibleRecipes.length === 0 ? (
            <div className="text-center py-8">
              <h2 className="text-lg font-semibold text-gray-500">No matching recipes</h2>
              <p className="text-sm text-gray-400 mt-1">
                Try a different search term.
              </p>
            </div>
          ) : (
            visibleRecipes.map((recipe) => (
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
            ))
          )}
        </div>
      )}
    </div>
  );
}
