"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Recipe } from "@/lib/types";
import { getRecipes, getWeeklyPlanIds, setWeeklyPlanIds, saveShoppingList } from "@/lib/storage";
import { getRecentRecipeViews, RecentRecipeViews } from "@/lib/recentViews";
import { RecipeSortOption, sortRecipes } from "@/lib/recipeSort";
import { mergeIngredients } from "@/lib/utils";
import { Check, ImageIcon, Search, ShoppingCart } from "lucide-react";
import Link from "next/link";
import PageLoadingScreen from "@/components/PageLoadingScreen";

export default function PlannerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<RecipeSortOption>("recently-viewed");
  const [recentViewsByRecipeId, setRecentViewsByRecipeId] =
    useState<RecentRecipeViews>({});

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [loadedRecipes, loadedSelectedIds] = await Promise.all([
          getRecipes(),
          getWeeklyPlanIds(),
        ]);

        if (!mounted) {
          return;
        }

        setRecipes(loadedRecipes);
        setSelectedIds(loadedSelectedIds);
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

  useEffect(() => {
    const addId = searchParams.get("add");
    if (!addId || recipes.length === 0 || selectedIds.includes(addId)) {
      return;
    }
    if (!recipes.some((recipe) => recipe.id === addId)) {
      return;
    }

    const next = [...selectedIds, addId];
    setSelectedIds(next);
    void setWeeklyPlanIds(next);
    router.replace("/planner");
  }, [recipes, router, searchParams, selectedIds]);

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
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900">Weekly Planner</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {loading
          ? "Loading recipes..."
          : `Select recipes for this week to generate your shopping list.${
              recipes.length > 0 ? ` · showing ${visibleRecipes.length}` : ""
            }`}
      </p>

      {loading ? (
        <PageLoadingScreen />
      ) : recipes.length === 0 ? (
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
            <div className="text-center py-14">
              <h2 className="text-lg font-semibold text-gray-500">No matching recipes</h2>
              <p className="text-sm text-gray-400 mt-1">Try a different search term.</p>
            </div>
          ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {visibleRecipes.map((recipe) => {
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
          )}

          {/* Sticky footer */}
          <div className="fixed bottom-16 left-0 right-0 px-4 pb-2 bg-gradient-to-t from-[var(--background)] pt-4">
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
