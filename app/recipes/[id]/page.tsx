"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildMyNetDiaryRecipeExport } from "@/lib/mynetdiary";
import { Recipe } from "@/lib/types";
import { RecipePriceEstimate } from "@/lib/recipePricing";
import { getRecipe, saveRecipe } from "@/lib/storage";
import { markRecipeViewed } from "@/lib/recentViews";
import IngredientEditor, { IngredientEditorMeta } from "@/components/IngredientEditor";
import StepEditor from "@/components/StepEditor";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  Copy,
  Save,
  Camera,
  X,
  ChevronDown,
  ChevronUp,
  UtensilsCrossed,
  Link2,
  ListOrdered,
  Loader2,
  ExternalLink,
  Share2,
  Star,
  Flame,
  ShoppingCart,
  RefreshCw,
} from "lucide-react";

const PRICING_CACHE_PREFIX = "cooking-be-easy-walmart-pricing";
const PRICING_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

function buildPricingCacheKey(recipe: Recipe): string {
  return [PRICING_CACHE_PREFIX, recipe.id, recipe.updatedAt].join(":");
}

function parseCachedPricing(rawValue: string | null): RecipePriceEstimate | null {
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as RecipePriceEstimate;
    const estimatedAt = Date.parse(parsed.estimatedAt);
    if (!Number.isFinite(estimatedAt)) return null;
    if (Date.now() - estimatedAt > PRICING_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function RecipeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [showIngredients, setShowIngredients] = useState(true);
  const [showSteps, setShowSteps] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [myNetDiaryCopied, setMyNetDiaryCopied] = useState(false);
  const [sharingToMyNetDiary, setSharingToMyNetDiary] = useState(false);
  const [priceEstimate, setPriceEstimate] = useState<RecipePriceEstimate | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingRefreshing, setPricingRefreshing] = useState(false);
  const [pricingError, setPricingError] = useState("");
  const [pricingRefreshNonce, setPricingRefreshNonce] = useState(0);

  useEffect(() => {
    getRecipe(id).then((r) => {
      if (!r) {
        router.replace("/recipes");
        return;
      }
      setRecipe(r);
      setName(r.name);
      markRecipeViewed(r.id);
    });
  }, [id, router]);

  useEffect(() => {
    if (!recipe) {
      setPricingLoading(false);
      setPricingRefreshing(false);
      return;
    }

    const currentRecipe = recipe;
    let cancelled = false;
    const recipeSnapshot = {
      name: currentRecipe.name,
      ingredients: currentRecipe.ingredients,
      updatedAt: currentRecipe.updatedAt,
      id: currentRecipe.id,
    };
    const hasExistingEstimate = priceEstimate !== null;
    const isManualRefresh = pricingRefreshNonce > 0;

    async function loadPricing() {
      const cacheKey = buildPricingCacheKey(currentRecipe);
      if (!isManualRefresh && !dirty && typeof window !== "undefined") {
        const cached = parseCachedPricing(window.localStorage.getItem(cacheKey));
        if (cached) {
          setPriceEstimate(cached);
          setPricingError("");
          setPricingLoading(false);
          setPricingRefreshing(false);
          return;
        }
      }

      if (hasExistingEstimate) {
        setPricingRefreshing(true);
      } else {
        setPricingLoading(true);
      }
      setPricingError("");

      try {
        const response = await fetch("/api/recipe-pricing", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            recipeName: recipeSnapshot.name,
            ingredients: recipeSnapshot.ingredients,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Failed to estimate ingredient prices"
          );
        }

        if (cancelled) return;
        setPriceEstimate(data as RecipePriceEstimate);
        setPricingError("");

        if (!dirty && typeof window !== "undefined") {
          window.localStorage.setItem(cacheKey, JSON.stringify(data));
        }
      } catch (error) {
        if (cancelled) return;
        setPricingError(
          error instanceof Error
            ? error.message
            : "Failed to estimate ingredient prices"
        );
      } finally {
        if (cancelled) return;
        setPricingLoading(false);
        setPricingRefreshing(false);
      }
    }

    loadPricing();

    return () => {
      cancelled = true;
    };
  }, [
    pricingRefreshNonce,
    recipe?.id,
    recipe?.updatedAt,
  ]);

  function updateIngredients(ingredients: Recipe["ingredients"]) {
    if (!recipe) return;
    setRecipe({ ...recipe, ingredients });
    setDirty(true);
  }

  function updateSteps(steps: Recipe["steps"]) {
    if (!recipe) return;
    setRecipe({ ...recipe, steps });
    setDirty(true);
  }

  function updateRecipeProfile(updates: Pick<Recipe, "rating" | "servingsYielded">) {
    if (!recipe) return;
    setRecipe({ ...recipe, ...updates });
    setDirty(true);
  }

  function updateRecipeNotes(notes: string) {
    if (!recipe) return;
    setRecipe({ ...recipe, notes });
    setDirty(true);
  }

  async function handleSave() {
    if (!recipe) return;
    const updated = { ...recipe, name, updatedAt: new Date().toISOString() };
    await saveRecipe(updated);
    setRecipe(updated);
    setDirty(false);
  }

  async function addDishPhoto(base64: string) {
    if (!recipe) return;
    const updated = {
      ...recipe,
      dishPhotos: [...recipe.dishPhotos, base64],
      updatedAt: new Date().toISOString(),
    };
    await saveRecipe(updated);
    setRecipe(updated);
  }

  async function removeDishPhoto(index: number) {
    if (!recipe) return;
    const updated = {
      ...recipe,
      dishPhotos: recipe.dishPhotos.filter((_, i) => i !== index),
      updatedAt: new Date().toISOString(),
    };
    await saveRecipe(updated);
    setRecipe(updated);
  }

  const ingredientPricingMetaById = useMemo<Record<string, IngredientEditorMeta>>(() => {
    if (!recipe) return {};

    const estimatesById = new Map(
      (priceEstimate?.ingredients ?? []).map((estimate) => [estimate.ingredientId, estimate])
    );

    return recipe.ingredients.reduce<Record<string, IngredientEditorMeta>>((acc, ingredient) => {
      const estimate = estimatesById.get(ingredient.id);

      if (estimate?.adjustedPriceText) {
        const detailParts = [
          estimate.matchTitle,
          estimate.matchStore,
          estimate.packageSizeText,
        ].filter(Boolean);

        acc[ingredient.id] = {
          label: `Est. ${estimate.adjustedPriceText}`,
          detail:
            detailParts.length > 0
              ? detailParts.join(" · ")
              : estimate.explanation ?? "Matched against Walmart grocery search results.",
          href: estimate.matchUrl,
        };
        return acc;
      }

      if (estimate?.unavailableReason) {
        acc[ingredient.id] = {
          label: "Price unavailable",
          detail: estimate.unavailableReason,
        };
        return acc;
      }

      if (pricingLoading && !priceEstimate) {
        acc[ingredient.id] = {
          label: "Checking prices...",
          detail: "Searching Walmart grocery results for a usable match.",
        };
        return acc;
      }

      if (dirty) {
        acc[ingredient.id] = {
          label: "Estimate may be stale",
          detail: "Save or refresh to update this ingredient price.",
        };
      }

      return acc;
    }, {});
  }, [dirty, priceEstimate, pricingLoading, recipe]);

  if (!recipe) return null;

  const myNetDiaryExport = buildMyNetDiaryRecipeExport(recipe);
  const sourceSteps = recipe.sourceSteps.length > 0 ? recipe.sourceSteps : recipe.steps;
  const canShareToMyNetDiary =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  const pricingSummary =
    "Estimated from USDA produce averages and Walmart grocery search results adjusted to this recipe's ingredient quantities.";

  async function copyMyNetDiaryExport() {
    try {
      await navigator.clipboard.writeText(myNetDiaryExport.fullText);
      setMyNetDiaryCopied(true);
      setTimeout(() => setMyNetDiaryCopied(false), 2000);
    } catch {
      // silently fail
    }
  }

  async function shareToMyNetDiary() {
    if (!canShareToMyNetDiary) return;

    setSharingToMyNetDiary(true);
    try {
      await navigator.share({
        title: myNetDiaryExport.title,
        text: myNetDiaryExport.fullText,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      await copyMyNetDiaryExport();
    } finally {
      setSharingToMyNetDiary(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Link href="/recipes" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors mt-0.5 shrink-0">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              className="w-full text-xl font-bold text-gray-900 border-b-2 border-brand-500 focus:outline-none bg-transparent"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
            />
          ) : (
            <h1
              className="text-xl font-bold text-gray-900 cursor-pointer hover:text-brand-700 truncate"
              onClick={() => setEditingName(true)}
              title="Click to edit name"
            >
              {name}
            </h1>
          )}
          <p className="text-xs text-gray-400 mt-0.5">
            {recipe.ingredients.length} ingredients
            {recipe.steps?.length ? ` · ${recipe.steps.length} steps` : ""}
            {" · "}{new Date(recipe.updatedAt).toLocaleDateString()}
          </p>
          {recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-0.5"
            >
              <Link2 size={11} />
              Source
            </a>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={`/cook/${recipe.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
            >
              <Flame size={12} />
              Cooking mode
            </Link>
            <Link
              href={`/shopping?add=${recipe.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ShoppingCart size={12} />
              Add to shopping
            </Link>
          </div>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors shrink-0"
          >
            <Save size={15} />
            Save
          </button>
        )}
      </div>

      {/* Dish Photos */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UtensilsCrossed size={18} className="text-brand-600" />
            Dish Photos
          </h2>
          <span className="text-xs text-gray-400">{recipe.dishPhotos.length} photos</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {recipe.dishPhotos.map((photo, i) => (
            <div key={i} className="relative aspect-square group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt={`Dish photo ${i + 1}`}
                className="w-full h-full object-cover rounded-xl border border-gray-200"
              />
              <button
                onClick={() => removeDishPhoto(i)}
                className="absolute top-1 right-1 p-1 bg-black/60 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* Add photo button */}
          <label className="aspect-square flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
            <Camera size={22} className="text-gray-400" />
            <span className="text-xs text-gray-400 mt-1">Add photo</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const { compressImage } = await import("@/lib/utils");
                  const base64 = await compressImage(file);
                  addDishPhoto(base64);
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Banknote size={18} className="text-brand-600" />
              Grocery Price Estimate
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {pricingSummary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPricingRefreshNonce((value) => value + 1)}
            disabled={pricingLoading || pricingRefreshing}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
          >
            {pricingLoading || pricingRefreshing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            Refresh
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            {priceEstimate?.unresolvedIngredientCount ? "Partial total" : "Recipe total"}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {priceEstimate ? priceEstimate.totalAdjustedPriceText : pricingLoading ? "Estimating..." : "--"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {priceEstimate
              ? `${priceEstimate.resolvedIngredientCount}/${recipe.ingredients.length} ingredients priced${
                  priceEstimate.unresolvedIngredientCount
                    ? ` · ${priceEstimate.unresolvedIngredientCount} need a manual check`
                    : ""
                } · Updated ${new Date(priceEstimate.estimatedAt).toLocaleString()}`
              : "Grocery pricing results will appear here after the lookup finishes."}
          </p>
        </div>

        {dirty && (
          <p className="mt-3 text-xs text-amber-700">
            Ingredient edits are not reflected until you save or refresh the estimate.
          </p>
        )}

        {pricingError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p>{pricingError}</p>
          </div>
        )}
      </div>

      {/* Ingredients */}
      <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-gray-900">Recipe Profile</h2>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Rating</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => {
              const filled = value <= (recipe.rating ?? 0);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    updateRecipeProfile({
                      rating: recipe.rating === value ? undefined : value,
                      servingsYielded: recipe.servingsYielded,
                    })
                  }
                  className={`p-1 rounded-md transition-colors ${
                    filled
                      ? "text-amber-500 hover:text-amber-600"
                      : "text-gray-300 hover:text-amber-400"
                  }`}
                  aria-label={`Set rating to ${value} star${value === 1 ? "" : "s"}`}
                  title={`Set rating to ${value} star${value === 1 ? "" : "s"}`}
                >
                  <Star size={22} fill={filled ? "currentColor" : "none"} />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Servings yielded
          </label>
          <input
            type="number"
            min="0"
            step="0.25"
            value={recipe.servingsYielded ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "") {
                updateRecipeProfile({
                  rating: recipe.rating,
                  servingsYielded: undefined,
                });
                return;
              }

              const parsed = Number(value);
              if (!Number.isFinite(parsed) || parsed < 0) return;

              updateRecipeProfile({
                rating: recipe.rating,
                servingsYielded: parsed,
              });
            }}
            placeholder="e.g. 4"
            className="w-full max-w-[12rem] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Notes
          </label>
          <textarea
            value={recipe.notes}
            onChange={(e) => updateRecipeNotes(e.target.value)}
            placeholder="Add your notes here..."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
          />
        </div>
      </div>

      <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">MyNetDiary Export</h2>
            <p className="text-sm text-gray-500 mt-1">
              Export this recipe into MyNetDiary&apos;s recipe import flow, then log it there as a meal.
            </p>
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            Recipe import
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {canShareToMyNetDiary && (
            <button
              type="button"
              onClick={shareToMyNetDiary}
              disabled={sharingToMyNetDiary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60"
            >
              {sharingToMyNetDiary ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Share2 size={15} />
              )}
              Share to MyNetDiary
            </button>
          )}

          <button
            type="button"
            onClick={copyMyNetDiaryExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {myNetDiaryCopied ? <Check size={15} /> : <Copy size={15} />}
            {myNetDiaryCopied ? "Copied" : "Copy for MyNetDiary"}
          </button>

          <a
            href="https://www.mynetdiary.com/recipe-import-help.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <ExternalLink size={15} />
            Import Help
          </a>
        </div>

        <p className="mt-3 text-xs text-gray-400">
          Share works best on iPhone or iPad when the MyNetDiary app and its recipe import share extension are installed.
        </p>
      </div>

      <div>
        <button
          className="w-full flex items-center justify-between font-semibold text-gray-900 mb-3"
          onClick={() => setShowIngredients(!showIngredients)}
        >
          <span>Ingredients ({recipe.ingredients.length})</span>
          {showIngredients ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showIngredients && (
          <>
            <IngredientEditor
              ingredients={recipe.ingredients}
              metaByIngredientId={ingredientPricingMetaById}
              onChange={(ings) => {
                updateIngredients(ings);
              }}
            />
            {dirty && (
              <button
                onClick={handleSave}
                className="mt-4 w-full py-2.5 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
              >
                Save changes
              </button>
            )}
          </>
        )}
      </div>

      <div className="mt-6">
        <button
          className="mb-3 flex w-full items-center justify-between font-semibold text-gray-900"
          onClick={() => setShowSteps(!showSteps)}
        >
          <span className="flex items-center gap-2">
            <ListOrdered size={18} className="text-brand-600" />
            Steps{recipe.steps.length > 0 ? ` (${recipe.steps.length})` : ""}
          </span>
          {showSteps ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        {showSteps && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Source Steps
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Read-only snapshot of the imported or original recipe steps.
                </p>
              </div>
              <div className="space-y-2">
                {sourceSteps.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
                    No source steps were saved for this recipe.
                  </div>
                ) : (
                  sourceSteps.map((sourceStep, index) => (
                    <div
                      key={`${index}-${sourceStep}`}
                      className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-700">
                        {index + 1}
                      </span>
                      <p className="text-sm leading-relaxed text-gray-700">
                        {sourceStep}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4">
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                  Cooking Mode Steps
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  These are the steps used in cooking mode. Edit this column only.
                </p>
              </div>
              <StepEditor
                steps={recipe.steps}
                onChange={updateSteps}
                emptyLabel="No cooking steps saved yet. Add the first one below."
              />
            </div>

            {dirty && (
              <button
                onClick={handleSave}
                className="lg:col-span-2 mt-1 w-full rounded-xl bg-brand-600 py-2.5 font-medium text-white transition-colors hover:bg-brand-700"
              >
                Save changes
              </button>
            )}
          </div>
        )}
      </div>

      {/* Original ingredient photo */}
      {recipe.ingredientPhoto && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Original ingredient list</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={recipe.ingredientPhoto}
            alt="Original ingredient list"
            className="w-full rounded-xl border border-gray-200"
          />
        </div>
      )}
    </div>
  );
}
