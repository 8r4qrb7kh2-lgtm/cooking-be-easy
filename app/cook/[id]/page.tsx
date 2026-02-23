"use client";

import {
  MutableRefObject,
  ReactNode,
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Ingredient, Recipe } from "@/lib/types";
import { getRecipe } from "@/lib/storage";
import { markRecipeViewed } from "@/lib/recentViews";
import { addGlobalTimer, extractTimerPresets, TimerPreset } from "@/lib/globalTimers";
import {
  buildIngredientMatchers,
  findStepIngredientCitations,
  formatIngredientAmount,
  formatIngredientCitationText,
  formatScaledQuantity,
  formatServingCount,
  scaleQuantityValue,
  StepIngredientCitation,
} from "@/lib/recipeSteps";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  List,
  Loader2,
  Moon,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";

interface ConvertedIngredient {
  convertedQuantity: string;
  toUnit: string;
  sourceQuantity: string;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const STEP_INGREDIENT_MAPPING_CACHE_KEY_PREFIX =
  "cooking-be-easy-step-ingredient-map";
const AUTO_STEP_TIMER_CACHE_KEY = "cooking-be-easy-auto-step-timers";

export default function CookingModePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [conversions, setConversions] = useState<
    Record<string, ConvertedIngredient>
  >({});
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertInputs, setConvertInputs] = useState<Record<string, string>>({});
  const desktopIngredientPanelRef = useRef<HTMLDivElement | null>(null);
  const mobileIngredientPanelRef = useRef<HTMLDivElement | null>(null);
  const desktopCurrentStepSectionRef = useRef<HTMLDivElement | null>(null);
  const mobileCurrentStepSectionRef = useRef<HTMLDivElement | null>(null);
  const [showResetIngredientFocus, setShowResetIngredientFocus] = useState(false);
  const [quantityScaleInput, setQuantityScaleInput] = useState("2");
  const [quantityScale, setQuantityScale] = useState(1);
  const [aiFirstStepByIngredientId, setAiFirstStepByIngredientId] = useState<
    Record<string, number> | null
  >(null);
  const [mobileIngredientsOpen, setMobileIngredientsOpen] = useState(false);

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [wakeLockAvailable, setWakeLockAvailable] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);

  const autoStepTimerKeysRef = useRef<Set<string>>(new Set());
  const [autoStepTimerKeysReady, setAutoStepTimerKeysReady] = useState(false);

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cached = window.localStorage.getItem(AUTO_STEP_TIMER_CACHE_KEY);
    if (!cached) {
      setAutoStepTimerKeysReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        autoStepTimerKeysRef.current = new Set(
          parsed.filter((value): value is string => typeof value === "string")
        );
      }
    } catch {
      // ignore corrupted cache
    }

    setAutoStepTimerKeysReady(true);
  }, []);

  const persistAutoStepTimerKeys = useCallback(() => {
    if (typeof window === "undefined") return;
    const trimmed = Array.from(autoStepTimerKeysRef.current).slice(-600);
    window.localStorage.setItem(AUTO_STEP_TIMER_CACHE_KEY, JSON.stringify(trimmed));
  }, []);

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
    const currentSectionRef = mobileIngredientsOpen
      ? mobileCurrentStepSectionRef
      : desktopCurrentStepSectionRef;
    const panelRef = mobileIngredientsOpen
      ? mobileIngredientPanelRef
      : desktopIngredientPanelRef;

    if (currentSectionRef.current) {
      currentSectionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else if (panelRef.current) {
      panelRef.current.scrollTo({ top: 0, behavior: "smooth" });
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
    ratedServingsYielded === null ? null : ratedServingsYielded * quantityScale;

  useEffect(() => {
    if (!recipe) return;

    const ingredientsPayload = recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    }));
    const stepsPayload = recipe.steps;

    if (ingredientsPayload.length === 0 || stepsPayload.length === 0) {
      setAiFirstStepByIngredientId({});
      return;
    }

    const cacheKey = `${STEP_INGREDIENT_MAPPING_CACHE_KEY_PREFIX}:${recipe.id}:${recipe.updatedAt}`;
    setAiFirstStepByIngredientId(null);

    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Record<string, unknown>;
          const validCached: Record<string, number> = {};

          for (const ingredient of ingredientsPayload) {
            const value = parsed[ingredient.id];
            if (
              typeof value === "number" &&
              Number.isInteger(value) &&
              value >= 0 &&
              value < stepsPayload.length
            ) {
              validCached[ingredient.id] = value;
            }
          }

          setAiFirstStepByIngredientId(validCached);
          return;
        } catch {
          // ignore invalid cache and fetch a fresh mapping
        }
      }
    }

    let cancelled = false;

    async function mapWithAi() {
      try {
        const res = await fetch("/api/map-step-ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingredients: ingredientsPayload,
            steps: stepsPayload,
          }),
        });
        if (!res.ok) throw new Error("Failed to map ingredients to steps");

        const data = await res.json();
        const source =
          data && typeof data === "object" && data.firstStepByIngredientId
            ? (data.firstStepByIngredientId as Record<string, unknown>)
            : {};

        const validMapping: Record<string, number> = {};
        for (const ingredient of ingredientsPayload) {
          const value = source[ingredient.id];
          if (
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 0 &&
            value < stepsPayload.length
          ) {
            validMapping[ingredient.id] = value;
          }
        }

        if (cancelled) return;

        setAiFirstStepByIngredientId(validMapping);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(cacheKey, JSON.stringify(validMapping));
        }
      } catch {
        if (!cancelled) {
          setAiFirstStepByIngredientId(null);
        }
      }
    }

    mapWithAi();

    return () => {
      cancelled = true;
    };
  }, [recipe]);

  const ingredientById = useMemo(
    () => new Map(recipeIngredients.map((ingredient) => [ingredient.id, ingredient])),
    [recipeIngredients]
  );

  const ingredientMatchers = useMemo(
    () => buildIngredientMatchers(recipeIngredients),
    [recipeIngredients]
  );

  const stepIngredientCitations = useMemo(
    () =>
      recipeSteps.map((recipeStep) =>
        findStepIngredientCitations(recipeStep, ingredientMatchers)
      ),
    [ingredientMatchers, recipeSteps]
  );

  const firstMentionStepByTextMatch = useMemo(() => {
    const firstMention = new Map<string, number>();
    stepIngredientCitations.forEach((citations, stepIndex) => {
      citations.forEach((citation) => {
        if (!firstMention.has(citation.ingredientId)) {
          firstMention.set(citation.ingredientId, stepIndex);
        }
      });
    });
    return firstMention;
  }, [stepIngredientCitations]);

  const firstMentionStepById = useMemo(() => {
    if (!aiFirstStepByIngredientId) {
      return firstMentionStepByTextMatch;
    }

    const firstMention = new Map<string, number>();
    for (const ingredient of recipeIngredients) {
      const aiStep = aiFirstStepByIngredientId[ingredient.id];
      if (
        typeof aiStep === "number" &&
        Number.isInteger(aiStep) &&
        aiStep >= 0 &&
        aiStep < totalSteps
      ) {
        firstMention.set(ingredient.id, aiStep);
        continue;
      }

      const fallbackStep = firstMentionStepByTextMatch.get(ingredient.id);
      if (fallbackStep !== undefined) {
        firstMention.set(ingredient.id, fallbackStep);
      }
    }

    return firstMention;
  }, [
    aiFirstStepByIngredientId,
    firstMentionStepByTextMatch,
    recipeIngredients,
    totalSteps,
  ]);

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

  const currentStepCitations =
    stepIngredientCitations[currentStep] ?? ([] as StepIngredientCitation[]);
  const nextStepCitations =
    currentStep + 1 < stepIngredientCitations.length
      ? stepIngredientCitations[currentStep + 1]
      : ([] as StepIngredientCitation[]);

  const renderStepWithIngredientCitations = useCallback(
    (
      stepText: string,
      citations: StepIngredientCitation[],
      className: string
    ): ReactNode => {
      if (!stepText) return stepText;
      if (citations.length === 0) return stepText;

      const output: ReactNode[] = [];
      let cursor = 0;

      for (let i = 0; i < citations.length; i++) {
        const citation = citations[i];
        if (citation.start > cursor) {
          output.push(stepText.slice(cursor, citation.start));
        }

        output.push(
          <strong
            key={`${citation.ingredientId}-${citation.start}-${citation.end}-${i}`}
            className={className}
          >
            {formatIngredientCitationText(citation, ingredientById, quantityScale)}
          </strong>
        );

        cursor = citation.end;
      }

      if (cursor < stepText.length) {
        output.push(stepText.slice(cursor));
      }

      return output;
    },
    [ingredientById, quantityScale]
  );

  const highlightedStep = useMemo(
    () =>
      renderStepWithIngredientCitations(
        step,
        currentStepCitations,
        "font-semibold text-gray-900"
      ),
    [currentStepCitations, renderStepWithIngredientCitations, step]
  );

  const highlightedNextStep = useMemo(() => {
    if (!nextStep) return null;
    return renderStepWithIngredientCitations(
      nextStep,
      nextStepCitations,
      "font-semibold text-gray-700"
    );
  }, [nextStep, nextStepCitations, renderStepWithIngredientCitations]);

  useEffect(() => {
    desktopIngredientPanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
    mobileIngredientPanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setShowResetIngredientFocus(false);
  }, [currentStep]);

  useEffect(() => {
    setConversions({});
    setConvertInputs({});
  }, [quantityScale]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setWakeLockAvailable("wakeLock" in navigator);
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // no-op
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!wakeLockAvailable || typeof navigator === "undefined") return;

    try {
      const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wakeLockApi) return;
      const sentinel = await wakeLockApi.request("screen");
      wakeLockRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
      });
      setWakeLockError(null);
    } catch {
      setWakeLockError("Always-on mode is unavailable on this device/browser.");
      setKeepScreenAwake(false);
    }
  }, [wakeLockAvailable]);

  useEffect(() => {
    if (!keepScreenAwake) {
      void releaseWakeLock();
      return;
    }
    void requestWakeLock();

    return () => {
      void releaseWakeLock();
    };
  }, [keepScreenAwake, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    if (!keepScreenAwake || !wakeLockAvailable) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [keepScreenAwake, requestWakeLock, wakeLockAvailable]);

  const currentStepTimerPresets = useMemo(
    () => extractTimerPresets(step),
    [step]
  );

  useEffect(() => {
    if (
      !autoStepTimerKeysReady ||
      !recipe ||
      currentStepTimerPresets.length === 0
    ) {
      return;
    }

    let changed = false;

    currentStepTimerPresets.forEach((preset) => {
      const key = `${recipe.id}:${currentStep}:${preset.durationSeconds}:${preset.sourceText.toLowerCase()}`;
      if (autoStepTimerKeysRef.current.has(key)) {
        return;
      }

      addGlobalTimer({
        label: `${recipe.name} · Step ${currentStep + 1} (${preset.label})`,
        durationSeconds: preset.durationSeconds,
        recipeId: recipe.id,
        stepNumber: currentStep + 1,
      });
      autoStepTimerKeysRef.current.add(key);
      changed = true;
    });

    if (changed) {
      persistAutoStepTimerKeys();
    }
  }, [
    autoStepTimerKeysReady,
    currentStep,
    currentStepTimerPresets,
    persistAutoStepTimerKeys,
    recipe,
  ]);

  function startTimerFromPreset(preset: TimerPreset) {
    if (!recipe) return;
    addGlobalTimer({
      label: `${recipe.name} · Step ${currentStep + 1} (${preset.label})`,
      durationSeconds: preset.durationSeconds,
      recipeId: recipe.id,
      stepNumber: currentStep + 1,
    });
  }

  function renderIngredientItem(ing: Ingredient, key: string, textClass: string) {
    const converted = conversions[ing.id];
    const isConverting = convertingId === ing.id;
    const scaledAmount = formatIngredientAmount(ing, quantityScale);

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
                  {scaledAmount && (
                    <span className="font-medium">{scaledAmount}</span>
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

  function renderIngredientPanel(
    panelRef: MutableRefObject<HTMLDivElement | null>,
    stepRef: MutableRefObject<HTMLDivElement | null>,
    dense = false
  ) {
    return (
      <div
        className={`bg-white rounded-2xl border border-gray-200 p-5 ${
          dense ? "h-full flex flex-col" : ""
        }`}
      >
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
          ref={panelRef}
          onScroll={handleIngredientPanelScroll}
          className={`${dense ? "flex-1" : "max-h-[28rem]"} overflow-y-auto pr-1 space-y-3`}
        >
          {upcomingStepIngredientGroups.map(({ stepIndex, ingredients }) => {
            const isCurrentGroup = stepIndex === currentStep;
            return (
              <div
                key={`step-ingredients-${stepIndex}`}
                ref={isCurrentGroup ? stepRef : undefined}
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
    );
  }

  if (!recipe) return null;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/cook"
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{recipe.name}</h1>
          <p className="text-xs text-gray-400">
            Step {currentStep + 1} of {totalSteps}
          </p>
        </div>
        <Flame size={20} className="text-brand-600 shrink-0" />
      </div>

      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-4">
        <div
          className="bg-brand-500 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button
          type="button"
          onClick={() => setKeepScreenAwake((value) => !value)}
          disabled={!wakeLockAvailable}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
            keepScreenAwake
              ? "border-brand-300 bg-brand-50 text-brand-700"
              : "border-gray-200 bg-white text-gray-600"
          } ${!wakeLockAvailable ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"}`}
        >
          {keepScreenAwake ? <Sun size={14} /> : <Moon size={14} />}
          Always-on screen
        </button>

        {currentStepTimerPresets.length > 0 && (
          <span className="inline-flex items-center rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs text-brand-700">
            <Clock3 size={12} className="mr-1.5" />
            {currentStepTimerPresets.length} timer
            {currentStepTimerPresets.length === 1 ? "" : "s"} auto-added
          </span>
        )}
      </div>

      {wakeLockError && (
        <p className="text-xs text-red-600 mb-4">{wakeLockError}</p>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <div className="flex items-start gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-brand-500 text-white text-lg font-bold flex items-center justify-center">
                {currentStep + 1}
              </span>
              <p className="text-gray-800 text-lg leading-relaxed pt-1">{highlightedStep}</p>
            </div>

            {currentStepTimerPresets.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Timers in this step
                </p>
                <div className="flex flex-wrap gap-2">
                  {currentStepTimerPresets.map((preset, index) => (
                    <button
                      key={`${preset.label}-${preset.durationSeconds}-${index}`}
                      type="button"
                      onClick={() => startTimerFromPreset(preset)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100 transition-colors"
                    >
                      <Clock3 size={12} />
                      Add {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {nextStep && (
            <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-6 opacity-60">
              <p className="text-xs font-medium text-gray-400 mb-1.5">Up next</p>
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

          {currentStep === totalSteps - 1 && (
            <div className="bg-brand-50 rounded-xl border border-brand-200 p-4 mb-6 text-center">
              <p className="text-brand-700 font-medium text-sm">
                This is the last step - enjoy your meal!
              </p>
            </div>
          )}

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

        <div className="hidden lg:block lg:w-80 shrink-0">
          {renderIngredientPanel(desktopIngredientPanelRef, desktopCurrentStepSectionRef)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMobileIngredientsOpen(true)}
        className="lg:hidden fixed left-4 bottom-24 z-40 inline-flex items-center gap-2 rounded-full bg-white border border-gray-200 px-4 py-2.5 shadow-md text-sm font-medium text-gray-700"
      >
        <List size={16} />
        Ingredients
      </button>

      {mobileIngredientsOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/35"
          onClick={() => setMobileIngredientsOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 h-full w-[88vw] max-w-sm bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Ingredients</h2>
              <button
                type="button"
                onClick={() => setMobileIngredientsOpen(false)}
                className="p-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                aria-label="Close ingredients"
              >
                <X size={16} />
              </button>
            </div>
            <div className="h-[calc(100%-2.5rem)]">
              {renderIngredientPanel(mobileIngredientPanelRef, mobileCurrentStepSectionRef, true)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
