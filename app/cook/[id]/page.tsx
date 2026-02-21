"use client";

import { ReactNode, UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Recipe, Ingredient } from "@/lib/types";
import { getRecipe } from "@/lib/storage";
import { markRecipeViewed } from "@/lib/recentViews";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flame,
  Loader2,
  RotateCcw,
} from "lucide-react";

interface ConvertedIngredient {
  convertedQuantity: string;
  toUnit: string;
  sourceQuantity: string;
}

interface IngredientMatcher {
  ingredient: Ingredient;
  patterns: string[];
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "\u00BC": "1/4",
  "\u00BD": "1/2",
  "\u00BE": "3/4",
  "\u2153": "1/3",
  "\u2154": "2/3",
  "\u215B": "1/8",
  "\u215C": "3/8",
  "\u215D": "5/8",
  "\u215E": "7/8",
};

function normalizeQuantityText(value: string): string {
  return value
    .trim()
    .replace(/[\u2012\u2013\u2014]/g, "-")
    .replace(/(\d)([\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E])/g, "$1 $2")
    .replace(/([\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E])(\d)/g, "$1 $2")
    .replace(
      /[\u00BC\u00BD\u00BE\u2153\u2154\u215B\u215C\u215D\u215E]/g,
      (match) => ` ${UNICODE_FRACTIONS[match] ?? match} `
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseSingleQuantity(value: string): number | null {
  const normalized = normalizeQuantityText(value).replace(/,/g, "");
  if (!normalized) return null;

  const mixedFraction = normalized.match(
    /^(-?\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/
  );
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (!Number.isFinite(whole) || denominator === 0) return null;

    const fraction = numerator / denominator;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * fraction;
  }

  const fraction = normalized.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }

  if (/^-?\d*\.?\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatScaledQuantity(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(rounded) < 0.000001) return "0";
  return rounded
    .toString()
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatServingCount(value: number): string {
  const formatted = formatScaledQuantity(value);
  return `${formatted} serving${formatted === "1" ? "" : "s"}`;
}

function scaleQuantityValue(quantity: string, factor: number): string {
  if (!quantity || factor === 1) return quantity;

  const normalized = normalizeQuantityText(quantity);
  if (!normalized) return quantity;

  const range = normalized.match(/^(.+?)\s*(?:-|to)\s*(.+)$/i);
  if (range) {
    const start = parseSingleQuantity(range[1]);
    const end = parseSingleQuantity(range[2]);
    if (start === null || end === null) return quantity;
    return `${formatScaledQuantity(start * factor)}-${formatScaledQuantity(
      end * factor
    )}`;
  }

  const parsed = parseSingleQuantity(normalized);
  if (parsed === null) return quantity;
  return formatScaledQuantity(parsed * factor);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIngredientText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWordForms(word: string): string[] {
  const normalized = normalizeIngredientText(word);
  if (!normalized) return [];

  const forms = new Set<string>([normalized]);

  if (normalized.endsWith("ies") && normalized.length > 4) {
    forms.add(`${normalized.slice(0, -3)}y`);
  } else if (
    /(ches|shes|xes|zes|ses|oes)$/.test(normalized) &&
    normalized.length > 4
  ) {
    forms.add(normalized.slice(0, -2));
  } else if (
    normalized.endsWith("s") &&
    !normalized.endsWith("ss") &&
    normalized.length > 3
  ) {
    forms.add(normalized.slice(0, -1));
  }

  if (!normalized.endsWith("s")) {
    if (normalized.endsWith("y") && normalized.length > 3) {
      forms.add(`${normalized.slice(0, -1)}ies`);
    } else {
      forms.add(`${normalized}s`);
    }
  }

  return Array.from(forms).filter((form) => form.length > 1);
}

function buildIngredientPatterns(name: string): string[] {
  const normalizedName = normalizeIngredientText(name);
  if (!normalizedName) return [];

  const words = normalizedName.split(" ").filter(Boolean);
  const phrases = new Set<string>();

  const addPhrase = (phrase: string) => {
    const normalizedPhrase = normalizeIngredientText(phrase);
    if (!normalizedPhrase || normalizedPhrase.length < 3) return;
    phrases.add(normalizedPhrase);
  };

  addPhrase(normalizedName);

  if (words.length > 1) {
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 2; end <= words.length; end++) {
        addPhrase(words.slice(start, end).join(" "));
      }
    }

    const prefix = words.slice(0, -1).join(" ");
    const lastWord = words[words.length - 1];
    for (const form of getWordForms(lastWord)) {
      addPhrase(`${prefix} ${form}`);
      addPhrase(form);
    }
  } else {
    for (const form of getWordForms(words[0])) {
      addPhrase(form);
    }
  }

  return Array.from(phrases)
    .sort((a, b) => b.length - a.length)
    .map((phrase) =>
      phrase
        .split(" ")
        .map((word) => escapeRegExp(word))
        .join("[\\s-]+")
    );
}

function stepMentionsIngredient(stepText: string, matcher: IngredientMatcher) {
  return matcher.patterns.some((pattern) =>
    new RegExp(`\\b${pattern}\\b`, "i").test(stepText)
  );
}

function highlightIngredientMentions(
  stepText: string,
  matchers: IngredientMatcher[],
  className: string
): ReactNode {
  if (!stepText) return stepText;

  const candidates: Array<{ start: number; end: number }> = [];

  for (const matcher of matchers) {
    for (const pattern of matcher.patterns) {
      const regex = new RegExp(`\\b${pattern}\\b`, "gi");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(stepText)) !== null) {
        candidates.push({
          start: match.index,
          end: match.index + match[0].length,
        });
        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
      }
    }
  }

  if (candidates.length === 0) return stepText;

  candidates.sort((a, b) => {
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.start - b.start;
  });

  const selected: Array<{ start: number; end: number }> = [];
  for (const candidate of candidates) {
    const overlaps = selected.some(
      (range) => candidate.start < range.end && candidate.end > range.start
    );
    if (!overlaps) selected.push(candidate);
  }

  selected.sort((a, b) => a.start - b.start);

  const output: ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < selected.length; i++) {
    const range = selected[i];
    if (range.start > cursor) {
      output.push(stepText.slice(cursor, range.start));
    }

    output.push(
      <strong key={`${range.start}-${range.end}-${i}`} className={className}>
        {stepText.slice(range.start, range.end)}
      </strong>
    );

    cursor = range.end;
  }

  if (cursor < stepText.length) {
    output.push(stepText.slice(cursor));
  }

  return output;
}

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [conversions, setConversions] = useState<
    Record<string, ConvertedIngredient>
  >({});
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertInputs, setConvertInputs] = useState<Record<string, string>>(
    {}
  );
  const ingredientPanelRef = useRef<HTMLDivElement | null>(null);
  const currentStepSectionRef = useRef<HTMLDivElement | null>(null);
  const [showResetIngredientFocus, setShowResetIngredientFocus] = useState(false);
  const [quantityScaleInput, setQuantityScaleInput] = useState("2");
  const [quantityScale, setQuantityScale] = useState(1);

  useEffect(() => {
    getRecipe(id).then((r) => {
      if (!r || !r.steps || r.steps.length === 0) {
        router.replace("/cook");
        return;
      }
      setRecipe(r);
      markRecipeViewed(r.id);
    });
  }, [id, router]);

  async function handleConvert(ingredient: Ingredient, targetUnit: string) {
    if (!targetUnit.trim() || !ingredient.quantity || !ingredient.unit) return;
    if (targetUnit.trim().toLowerCase() === ingredient.unit.toLowerCase()) return;

    const quantityForConversion = scaleQuantityValue(
      ingredient.quantity,
      quantityScale
    );

    setConvertingId(ingredient.id);
    try {
      const res = await fetch("/api/convert-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientName: ingredient.name,
          quantity: quantityForConversion,
          fromUnit: ingredient.unit,
          toUnit: targetUnit.trim(),
        }),
      });

      if (!res.ok) throw new Error("Conversion failed");

      const data = await res.json();
      setConversions((prev) => ({
        ...prev,
        [ingredient.id]: {
          convertedQuantity: data.convertedQuantity,
          toUnit: targetUnit.trim(),
          sourceQuantity: quantityForConversion,
        },
      }));
    } catch {
      // silently fail — user can retry
    } finally {
      setConvertingId(null);
    }
  }

  function revertConversion(ingredientId: string) {
    setConversions((prev) => {
      const next = { ...prev };
      delete next[ingredientId];
      return next;
    });
    setConvertInputs((prev) => {
      const next = { ...prev };
      delete next[ingredientId];
      return next;
    });
  }

  function handleIngredientPanelScroll(event: UIEvent<HTMLDivElement>) {
    setShowResetIngredientFocus(event.currentTarget.scrollTop > 0);
  }

  function resetIngredientPanelFocus() {
    if (currentStepSectionRef.current) {
      currentStepSectionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else if (ingredientPanelRef.current) {
      ingredientPanelRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    setShowResetIngredientFocus(false);
  }

  function applyQuantityScale(mode: "multiply" | "divide") {
    const value = Number(quantityScaleInput);
    if (!Number.isFinite(value) || value <= 0) return;
    setQuantityScale(mode === "multiply" ? value : 1 / value);
  }

  const recipeIngredients = recipe?.ingredients ?? [];
  const recipeSteps = recipe?.steps ?? [];
  const totalSteps = recipeSteps.length;
  const step = recipeSteps[currentStep] ?? "";
  const nextStep =
    currentStep < totalSteps - 1 ? recipeSteps[currentStep + 1] : null;
  const ratedServingsYielded =
    recipe?.servingsYielded && recipe.servingsYielded > 0
      ? recipe.servingsYielded
      : null;
  const scaledServingsYielded =
    ratedServingsYielded === null
      ? null
      : ratedServingsYielded * quantityScale;

  const ingredientMatchers = useMemo<IngredientMatcher[]>(
    () =>
      recipeIngredients.map((ingredient) => ({
        ingredient,
        patterns: buildIngredientPatterns(ingredient.name),
      })),
    [recipeIngredients]
  );

  const firstMentionStepById = useMemo(() => {
    const firstMention = new Map<string, number>();
    for (const matcher of ingredientMatchers) {
      if (matcher.patterns.length === 0) continue;
      const stepIndex = recipeSteps.findIndex((recipeStep) =>
        stepMentionsIngredient(recipeStep, matcher)
      );
      if (stepIndex >= 0) {
        firstMention.set(matcher.ingredient.id, stepIndex);
      }
    }
    return firstMention;
  }, [ingredientMatchers, recipeSteps]);

  const ingredientsByFirstMentionStep = useMemo(() => {
    const grouped = new Map<number, Ingredient[]>();
    for (const ingredient of recipeIngredients) {
      const stepIndex = firstMentionStepById.get(ingredient.id);
      if (stepIndex === undefined) continue;

      const existing = grouped.get(stepIndex);
      if (existing) {
        existing.push(ingredient);
      } else {
        grouped.set(stepIndex, [ingredient]);
      }
    }
    return grouped;
  }, [firstMentionStepById, recipeIngredients]);

  const upcomingStepIngredientGroups = useMemo(() => {
    const groups: Array<{ stepIndex: number; ingredients: Ingredient[] }> = [];
    for (let stepIndex = currentStep; stepIndex < totalSteps; stepIndex++) {
      const ingredients = ingredientsByFirstMentionStep.get(stepIndex) ?? [];
      if (stepIndex !== currentStep && ingredients.length === 0) continue;
      groups.push({ stepIndex, ingredients });
    }
    return groups;
  }, [currentStep, ingredientsByFirstMentionStep, totalSteps]);

  const highlightedStep = useMemo(
    () =>
      highlightIngredientMentions(
        step,
        ingredientMatchers,
        "font-semibold text-gray-900"
      ),
    [ingredientMatchers, step]
  );

  const highlightedNextStep = useMemo(() => {
    if (!nextStep) return null;
    return highlightIngredientMentions(
      nextStep,
      ingredientMatchers,
      "font-semibold text-gray-700"
    );
  }, [ingredientMatchers, nextStep]);

  useEffect(() => {
    if (!ingredientPanelRef.current) return;
    ingredientPanelRef.current.scrollTo({ top: 0, behavior: "auto" });
    setShowResetIngredientFocus(false);
  }, [currentStep]);

  useEffect(() => {
    setConversions({});
    setConvertInputs({});
  }, [quantityScale]);

  function renderIngredientItem(ing: Ingredient, key: string, textClass: string) {
    const converted = conversions[ing.id];
    const isConverting = convertingId === ing.id;
    const scaledQuantity = scaleQuantityValue(ing.quantity, quantityScale);

    return (
      <li key={key} className="text-sm">
        <div className="flex items-start gap-2">
          <span className="text-brand-500 mt-0.5">•</span>
          <div className="flex-1 min-w-0">
            <span className={textClass}>
              {converted ? (
                <>
                  <span className="font-medium">
                    {converted.convertedQuantity} {converted.toUnit}
                  </span>{" "}
                  {ing.name}
                  <button
                    onClick={() => revertConversion(ing.id)}
                    className="ml-1.5 text-gray-400 hover:text-gray-600 inline-flex items-center"
                    title="Revert to original"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <span className="block text-xs text-gray-400 mt-0.5">
                    was {converted.sourceQuantity} {ing.unit}
                  </span>
                </>
              ) : (
                <>
                  {scaledQuantity && (
                    <span className="font-medium">
                      {scaledQuantity}
                      {ing.unit ? ` ${ing.unit}` : ""}
                    </span>
                  )}{" "}
                  {ing.name}
                </>
              )}
            </span>

            {ing.quantity && ing.unit && !converted && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Convert to..."
                  className="w-24 text-xs px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:border-brand-400 bg-gray-50"
                  value={convertInputs[ing.id] || ""}
                  onChange={(e) =>
                    setConvertInputs((prev) => ({
                      ...prev,
                      [ing.id]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleConvert(ing, convertInputs[ing.id] || "");
                    }
                  }}
                  onBlur={() => {
                    const val = convertInputs[ing.id];
                    if (val && val.trim()) {
                      handleConvert(ing, val);
                    }
                  }}
                  disabled={isConverting}
                />
                {isConverting && (
                  <Loader2 size={14} className="text-brand-500 animate-spin" />
                )}
              </div>
            )}
          </div>
        </div>
      </li>
    );
  }

  if (!recipe) return null;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/cook"
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">
            {recipe.name}
          </h1>
          <p className="text-xs text-gray-400">
            Step {currentStep + 1} of {totalSteps}
          </p>
        </div>
        <Flame size={20} className="text-brand-600 shrink-0" />
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-6">
        <div
          className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Steps */}
        <div className="flex-1">
          {/* Current step */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <div className="flex items-start gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-brand-500 text-white text-lg font-bold flex items-center justify-center">
                {currentStep + 1}
              </span>
              <p className="text-gray-800 text-lg leading-relaxed pt-1">
                {highlightedStep}
              </p>
            </div>
          </div>

          {/* Next step preview */}
          {nextStep && (
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-6 opacity-60">
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                Up next
              </p>
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-7 h-7 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center">
                  {currentStep + 2}
                </span>
                <p className="text-sm text-gray-500 leading-relaxed">
                  {highlightedNextStep}
                </p>
              </div>
            </div>
          )}

          {/* Done message */}
          {currentStep === totalSteps - 1 && (
            <div className="bg-brand-50 rounded-xl border border-brand-200 p-4 mb-6 text-center">
              <p className="text-brand-700 font-medium text-sm">
                This is the last step — enjoy your meal!
              </p>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
              disabled={currentStep === 0}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-white border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={18} />
              Previous
            </button>
            <button
              onClick={() =>
                setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))
              }
              disabled={currentStep === totalSteps - 1}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-xl font-medium hover:bg-brand-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Right: Ingredients */}
        <div className="lg:w-80 shrink-0">
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
                  Ingredients
                </h2>
                <button
                  onClick={resetIngredientPanelFocus}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${
                    showResetIngredientFocus
                      ? "opacity-100 translate-y-0 border-brand-200 text-brand-700 bg-brand-50"
                      : "opacity-0 -translate-y-1 pointer-events-none border-transparent"
                  }`}
                >
                  Reset to current
                </button>
              </div>

              <div className="mt-2.5 p-2.5 rounded-lg border border-gray-200 bg-gray-50">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
                  Scale quantities
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={quantityScaleInput}
                    onChange={(e) => setQuantityScaleInput(e.target.value)}
                    className="w-20 text-xs px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:border-brand-400 bg-white"
                  />
                  <button
                    onClick={() => applyQuantityScale("multiply")}
                    className="text-xs px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                  >
                    Multiply
                  </button>
                  <button
                    onClick={() => applyQuantityScale("divide")}
                    className="text-xs px-2.5 py-1 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                  >
                    Divide
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">
                    Current: x{formatScaledQuantity(quantityScale)}
                  </span>
                  <button
                    onClick={() => setQuantityScale(1)}
                    className={`text-[11px] text-brand-700 hover:underline ${
                      quantityScale === 1 ? "opacity-0 pointer-events-none" : ""
                    }`}
                  >
                    Reset
                  </button>
                </div>
                {ratedServingsYielded !== null && scaledServingsYielded !== null && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Rated yield: {formatServingCount(ratedServingsYielded)} -&gt;{" "}
                    {formatServingCount(scaledServingsYielded)}
                  </p>
                )}
              </div>
            </div>

            <div
              ref={ingredientPanelRef}
              onScroll={handleIngredientPanelScroll}
              className="max-h-[28rem] overflow-y-auto pr-1 space-y-3"
            >
              {upcomingStepIngredientGroups.map(({ stepIndex, ingredients }) => {
                const isCurrentGroup = stepIndex === currentStep;
                return (
                  <div
                    key={`step-ingredients-${stepIndex}`}
                    ref={isCurrentGroup ? currentStepSectionRef : undefined}
                    className={`rounded-xl border p-3 ${
                      isCurrentGroup
                        ? "border-brand-200 bg-brand-50/60"
                        : "border-gray-100 bg-white"
                    }`}
                  >
                    <p
                      className={`text-xs font-medium uppercase tracking-wide mb-2 ${
                        isCurrentGroup ? "text-brand-700" : "text-gray-400"
                      }`}
                    >
                      {isCurrentGroup
                        ? `Current step (${stepIndex + 1})`
                        : `Step ${stepIndex + 1}`}
                    </p>

                    {ingredients.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        No new ingredients in this step.
                      </p>
                    ) : (
                      <ul className="space-y-2.5">
                        {ingredients.map((ing) =>
                          renderIngredientItem(
                            ing,
                            `${stepIndex}-${ing.id}`,
                            isCurrentGroup ? "text-gray-800" : "text-gray-700"
                          )
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
