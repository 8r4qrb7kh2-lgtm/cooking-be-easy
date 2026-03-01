"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ingredient, GrocerySection } from "@/lib/types";
import { saveRecipe } from "@/lib/storage";
import { normalizeRecipeSteps } from "@/lib/recipeSteps";
import ImageUpload from "@/components/ImageUpload";
import IngredientEditor from "@/components/IngredientEditor";
import { v4 as uuidv4 } from "uuid";
import { ArrowLeft, Loader2, Sparkles, ChevronRight, Camera, Link2, PenLine } from "lucide-react";
import Link from "next/link";

type Step = "name" | "source" | "review";
type SourceMode = "photo" | "url" | "manual";

export default function NewRecipePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [sourceMode, setSourceMode] = useState<SourceMode>("photo");
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | undefined>();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  async function analyzePhoto(base64: string) {
    setPhoto(base64);
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/analyze-ingredients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      setIngredients(
        (data.ingredients || []).map(
          (item: { name: string; quantity: string; unit: string; section: string }) => ({
            id: uuidv4(),
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            section: (item.section as GrocerySection) || "Other",
          })
        )
      );
      setSteps(normalizeRecipeSteps(data.steps || []));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze image");
    } finally {
      setAnalyzing(false);
    }
  }

  async function importFromUrl() {
    if (!urlInput.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/import-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      if (data.name && !name.trim()) setName(data.name);
      setIngredients(
        (data.ingredients || []).map(
          (item: { name: string; quantity: string; unit: string; section: string }) => ({
            id: uuidv4(),
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            section: (item.section as GrocerySection) || "Other",
          })
        )
      );
      setSteps(normalizeRecipeSteps(data.steps || []));
      setSourceUrl(urlInput.trim());
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import recipe");
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    const recipe = {
      id: uuidv4(),
      name: name.trim(),
      ingredients,
      steps,
      notes,
      dishPhotos: [],
      ingredientPhoto: photo || undefined,
      sourceUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveRecipe(recipe);
    router.push(`/recipes/${recipe.id}`);
  }

  const stepLabels: Record<Step, string> = { name: "Name", source: "Source", review: "Review" };

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/recipes" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">New Recipe</h1>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {(["name", "source", "review"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                s === step
                  ? "bg-brand-600 text-white"
                  : (step === "review" || (step === "source" && i === 0))
                  ? "bg-brand-100 text-brand-700"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs ${s === step ? "text-brand-700 font-medium" : "text-gray-400"}`}>
              {stepLabels[s]}
            </span>
            {i < 2 && <ChevronRight size={14} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step: Name */}
      {step === "name" && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Recipe name</label>
            <input
              autoFocus
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="e.g. Chicken Tikka Masala"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep("source")}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              You can also leave this blank — it will be filled in automatically when importing from a URL.
            </p>
          </div>
          <button
            onClick={() => setStep("source")}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Source */}
      {step === "source" && (
        <div className="space-y-4">
          {/* Mode tabs */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { mode: "url" as SourceMode, icon: Link2, label: "From URL" },
              { mode: "photo" as SourceMode, icon: Camera, label: "Photo" },
              { mode: "manual" as SourceMode, icon: PenLine, label: "Manual" },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => { setSourceMode(mode); setError(""); }}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  sourceMode === mode
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-gray-200 text-gray-500 hover:border-gray-300"
                }`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>

          {/* URL mode */}
          {sourceMode === "url" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Paste a link to any recipe page. Claude AI will extract the ingredients and steps automatically.
              </p>
              <input
                autoFocus
                type="url"
                className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="https://www.example.com/recipe/..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && importFromUrl()}
                disabled={analyzing}
              />
              {analyzing ? (
                <div className="flex items-center justify-center gap-2 py-6 text-brand-700 font-medium">
                  <Loader2 size={20} className="animate-spin" />
                  <Sparkles size={16} />
                  Scraping &amp; analyzing with Claude AI…
                </div>
              ) : (
                <button
                  onClick={importFromUrl}
                  disabled={!urlInput.trim()}
                  className="w-full py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Import Recipe
                </button>
              )}
            </div>
          )}

          {/* Photo mode */}
          {sourceMode === "photo" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Use your camera or choose a file of the ingredient list. Claude AI will extract the ingredients.
              </p>
              {analyzing ? (
                <div className="flex items-center justify-center gap-2 py-10 text-brand-700 font-medium">
                  <Loader2 size={24} className="animate-spin" />
                  <Sparkles size={16} />
                  Analyzing with Claude AI…
                </div>
              ) : (
                <ImageUpload label="Photo of ingredient list" onImage={analyzePhoto} className="h-44" />
              )}
            </div>
          )}

          {/* Manual mode */}
          {sourceMode === "manual" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Skip straight to the ingredient editor and add everything by hand.
              </p>
              <button
                onClick={() => setStep("review")}
                className="w-full py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors"
              >
                Continue to Editor
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div className="space-y-5">
          {/* Recipe name (editable if auto-filled) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Recipe name</label>
            <input
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter recipe name"
            />
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900 text-sm">
                Ingredients{ingredients.length > 0 ? ` (${ingredients.length})` : ""}
              </h2>
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="ingredient list" className="w-10 h-10 object-cover rounded-lg border border-gray-200" />
              )}
            </div>
            <IngredientEditor ingredients={ingredients} onChange={setIngredients} />
          </div>

          {/* Steps */}
          {steps.length > 0 && (
            <div>
              <h2 className="font-semibold text-gray-900 text-sm mb-2">
                Steps ({steps.length})
              </h2>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <textarea
                      className="flex-1 text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                      rows={2}
                      value={step}
                      onChange={(e) => {
                        const next = [...steps];
                        next[i] = e.target.value;
                        setSteps(next);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceUrl && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Link2 size={12} />
              Imported from{" "}
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline truncate max-w-xs">
                {sourceUrl}
              </a>
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes for this recipe"
              rows={4}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 resize-y"
            />
          </div>

          <button
            onClick={save}
            disabled={ingredients.length === 0 || !name.trim()}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Recipe
          </button>
          {(ingredients.length === 0 || !name.trim()) && (
            <p className="text-center text-xs text-gray-400">
              {!name.trim() ? "Add a recipe name" : "Add at least one ingredient"} to save
            </p>
          )}
        </div>
      )}
    </div>
  );
}
