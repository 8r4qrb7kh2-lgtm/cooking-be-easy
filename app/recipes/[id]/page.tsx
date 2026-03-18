"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildMyNetDiaryRecipeExport } from "@/lib/mynetdiary";
import { Recipe } from "@/lib/types";
import { getRecipe, saveRecipe } from "@/lib/storage";
import { markRecipeViewed } from "@/lib/recentViews";
import IngredientEditor from "@/components/IngredientEditor";
import Link from "next/link";
import {
  ArrowLeft,
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
  CalendarDays,
} from "lucide-react";

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

  function updateIngredients(ingredients: Recipe["ingredients"]) {
    if (!recipe) return;
    setRecipe({ ...recipe, ingredients });
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

  if (!recipe) return null;

  const myNetDiaryExport = buildMyNetDiaryRecipeExport(recipe);
  const canShareToMyNetDiary =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

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
              {recipe.name}
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
              href={`/planner?add=${recipe.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <CalendarDays size={12} />
              Add to planner
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

      {/* Steps */}
      {recipe.steps?.length > 0 && (
        <div className="mt-6">
          <button
            className="w-full flex items-center justify-between font-semibold text-gray-900 mb-3"
            onClick={() => setShowSteps(!showSteps)}
          >
            <span className="flex items-center gap-2">
              <ListOrdered size={18} className="text-brand-600" />
              Steps ({recipe.steps.length})
            </span>
            {showSteps ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showSteps && (
            <ol className="space-y-3">
              {recipe.steps.map((step, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

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
