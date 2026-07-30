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
import { logCookedToday, wasCookedToday } from "@/lib/cookLog";
import { markRecipeViewed } from "@/lib/recentViews";
import { extractTimerPresets } from "@/lib/globalTimers";
import GlobalTimerTray, { SuggestedTimer } from "@/components/GlobalTimerTray";
import RecipeTableView from "@/components/RecipeTableView";
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
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  List,
  Loader2,
  Moon,
  RotateCcw,
  Sun,
  Table2,
  UtensilsCrossed,
  X,
} from "lucide-react";

type CookingView = "steps" | "table";

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

const STEP_TIMER_ACTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcarameli[sz](?:e|ed|ing)?\b/i, label: "caramelize" },
  { pattern: /\bbrown(?:ed|ing)?\b/i, label: "brown" },
  { pattern: /\bsimmer(?:ed|ing)?\b/i, label: "simmer" },
  { pattern: /\bboil(?:ed|ing)?\b/i, label: "boil" },
  { pattern: /\btoast(?:ed|ing)?\b/i, label: "toast" },
  { pattern: /\broast(?:ed|ing)?\b/i, label: "roast" },
  { pattern: /\bbake(?:d|ing)?\b/i, label: "bake" },
  { pattern: /\bsear(?:ed|ing)?\b/i, label: "sear" },
  { pattern: /\bgrill(?:ed|ing)?\b/i, label: "grill" },
  { pattern: /\bfry(?:ing|ied)?\b/i, label: "fry" },
  { pattern: /\bsteam(?:ed|ing)?\b/i, label: "steam" },
  { pattern: /\bmelt(?:ed|ing)?\b/i, label: "melt" },
  { pattern: /\breduc(?:e|ed|ing)\b/i, label: "reduce" },
  { pattern: /\brest(?:ed|ing)?\b/i, label: "rest" },
  { pattern: /\bchill(?:ed|ing)?\b/i, label: "chill" },
  { pattern: /\bcook(?:ed|ing)?\b/i, label: "cook" },
];

const INGREDIENT_DESCRIPTOR_WORDS = new Set([
  "large",
  "small",
  "medium",
  "fresh",
  "white",
  "yellow",
  "red",
  "green",
  "whole",
  "chopped",
  "diced",
  "minced",
  "optional",
]);

function simplifyIngredientName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const words = cleaned.split(" ").filter(Boolean);
  const withoutDescriptors = words.filter(
    (word) => !INGREDIENT_DESCRIPTOR_WORDS.has(word)
  );
  const source = withoutDescriptors.length > 0 ? withoutDescriptors : words;

  if (source.length > 2 && source[source.length - 1].endsWith("s")) {
    return source[source.length - 1];
  }

  return source.slice(-2).join(" ");
}

function buildStepTimerTitle(
  stepText: string,
  citations: StepIngredientCitation[],
  ingredientById: Map<string, Ingredient>
): string {
  let action = "";
  for (const candidate of STEP_TIMER_ACTION_PATTERNS) {
    if (candidate.pattern.test(stepText)) {
      action = candidate.label;
      break;
    }
  }

  let target = "";
  for (const citation of citations) {
    const ingredient = ingredientById.get(citation.ingredientId);
    if (!ingredient) continue;
    const simplified = simplifyIngredientName(ingredient.name);
    if (simplified) {
      target = simplified;
      break;
    }
  }

  let label = "";
  if (action && target) {
    label = `${action} ${target}`;
  } else if (target) {
    label = target;
  } else if (action) {
    label = action;
  } else {
    const fallback = stepText
      .replace(/\([^)]*\)/g, " ")
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:-|to)?\s*\d*(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .split(/[.;,]/)[0]
      .trim();
    label = fallback.split(" ").slice(0, 4).join(" ");
  }

  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized) return "step timer";
  return normalized.slice(0, 40);
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
  const [showSourceSteps, setShowSourceSteps] = useState(false);
  const [mobileIngredientsOpen, setMobileIngredientsOpen] = useState(false);
  const [cookingView, setCookingView] = useState<CookingView>("steps");

  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [wakeLockAvailable, setWakeLockAvailable] = useState(false);
  const [keepScreenAwake, setKeepScreenAwake] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);

  // "Did you make this today?" prompt shown once on entering cooking mode. A
  // "Yes" is the only way a cook is logged (which drives "days since last made").
  const [showCookPrompt, setShowCookPrompt] = useState(false);
  const [cookLogState, setCookLogState] = useState<"idle" | "logging" | "logged">(
    "idle"
  );

  useEffect(() => {
    let cancelled = false;
    getRecipe(id).then(async (r) => {
      if (!r || !r.steps || r.steps.length === 0) {
        router.replace("/cook");
        return;
      }
      if (cancelled) return;
      setRecipe(r);
      markRecipeViewed(r.id);
      // Only ask "Cooking this today?" if the dish hasn't already been logged
      // today. Once anyone cooking together confirms it, the prompt stops
      // showing for the rest of the day so a dish is logged at most once daily.
      const alreadyLogged = await wasCookedToday(r.id).catch(() => false);
      if (!cancelled && !alreadyLogged) setShowCookPrompt(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function confirmCookedToday() {
    if (!recipe || cookLogState === "logging") return;
    setCookLogState("logging");
    try {
      await logCookedToday(recipe.id);
      setCookLogState("logged");
    } catch {
      setCookLogState("idle");
    } finally {
      setShowCookPrompt(false);
    }
  }

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

  const focusIngredientPanelCurrentStep = useCallback(
    (target: "desktop" | "mobile", behavior: ScrollBehavior = "smooth") => {
      const currentSectionRef =
        target === "mobile"
          ? mobileCurrentStepSectionRef
          : desktopCurrentStepSectionRef;
      const panelRef =
        target === "mobile" ? mobileIngredientPanelRef : desktopIngredientPanelRef;

      if (currentSectionRef.current) {
        currentSectionRef.current.scrollIntoView({
          behavior,
          block: "center",
        });
      } else if (panelRef.current) {
        panelRef.current.scrollTo({ top: 0, behavior });
      }
    },
    []
  );

  function resetIngredientPanelFocus() {
    focusIngredientPanelCurrentStep(
      mobileIngredientsOpen ? "mobile" : "desktop",
      "smooth"
    );
    setShowResetIngredientFocus(false);
  }

  function applyQuantityScale(mode: "multiply" | "divide") {
    const value = Number(quantityScaleInput);
    if (!Number.isFinite(value) || value <= 0) return;
    setQuantityScale(mode === "multiply" ? value : 1 / value);
  }

  const recipeIngredients = recipe?.ingredients ?? [];
  const hasSourceSteps = (recipe?.sourceSteps.length ?? 0) > 0;
  const hasDistinctSourceSteps = useMemo(() => {
    if (!recipe || !hasSourceSteps) return false;
    if (recipe.sourceSteps.length !== recipe.steps.length) return true;
    return recipe.sourceSteps.some((sourceStep, index) => sourceStep !== recipe.steps[index]);
  }, [hasSourceSteps, recipe]);
  const recipeSteps =
    showSourceSteps && hasDistinctSourceSteps
      ? recipe?.sourceSteps ?? []
      : recipe?.steps ?? [];
  const stepSourceKey =
    showSourceSteps && hasDistinctSourceSteps ? "source" : "cooking";
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
    setCurrentStep((stepIndex) =>
      Math.min(stepIndex, Math.max(recipeSteps.length - 1, 0))
    );
  }, [recipeSteps.length]);

  useEffect(() => {
    if (!hasDistinctSourceSteps && showSourceSteps) {
      setShowSourceSteps(false);
    }
  }, [hasDistinctSourceSteps, showSourceSteps]);

  useEffect(() => {
    if (!recipe) return;

    const ingredientsPayload = recipe.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    }));
    const stepsPayload = recipeSteps;

    if (ingredientsPayload.length === 0 || stepsPayload.length === 0) {
      setAiFirstStepByIngredientId({});
      return;
    }

    const cacheKey = `${STEP_INGREDIENT_MAPPING_CACHE_KEY_PREFIX}:${recipe.id}:${stepSourceKey}:${recipe.updatedAt}`;
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
  }, [recipe, recipeSteps, stepSourceKey]);

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
    for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
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
    if (!mobileIngredientsOpen) {
      mobileIngredientPanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }
    setShowResetIngredientFocus(false);
  }, [currentStep, mobileIngredientsOpen]);

  useEffect(() => {
    setConversions({});
    setConvertInputs({});
  }, [quantityScale]);

  // The table lists every ingredient itself, so the slide-over would just sit
  // there holding the body scroll lock.
  useEffect(() => {
    if (cookingView === "table") setMobileIngredientsOpen(false);
  }, [cookingView]);

  useEffect(() => {
    if (!mobileIngredientsOpen || typeof window === "undefined") return;
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const originalPosition = bodyStyle.position;
    const originalTop = bodyStyle.top;
    const originalWidth = bodyStyle.width;
    const originalOverflow = bodyStyle.overflow;

    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.width = "100%";
    bodyStyle.overflow = "hidden";

    return () => {
      bodyStyle.position = originalPosition;
      bodyStyle.top = originalTop;
      bodyStyle.width = originalWidth;
      bodyStyle.overflow = originalOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [mobileIngredientsOpen]);

  useEffect(() => {
    if (!mobileIngredientsOpen) return;

    const raf = window.requestAnimationFrame(() => {
      focusIngredientPanelCurrentStep("mobile", "auto");
      const panelTop = mobileIngredientPanelRef.current?.scrollTop ?? 0;
      setShowResetIngredientFocus(panelTop > 0);
    });

    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [currentStep, focusIngredientPanelCurrentStep, mobileIngredientsOpen]);

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

  const suggestedStepTimers = useMemo<SuggestedTimer[]>(() => {
    if (!recipe || currentStepTimerPresets.length === 0) return [];

    const title = buildStepTimerTitle(step, currentStepCitations, ingredientById);
    return currentStepTimerPresets.map((preset, index) => ({
      id: `${recipe.id}-${currentStep}-${index}-${preset.durationSeconds}`,
      buttonLabel: preset.label,
      durationSeconds: preset.durationSeconds,
      title,
      recipeId: recipe.id,
      stepNumber: currentStep + 1,
    }));
  }, [
    currentStep,
    currentStepCitations,
    currentStepTimerPresets,
    ingredientById,
    recipe,
    step,
  ]);

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

  function renderQuantityScaleControls() {
    return (
      <div className="p-2.5 rounded-lg border border-gray-200 bg-gray-50">
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

          <div className="mt-2.5">{renderQuantityScaleControls()}</div>
        </div>

        <div
          ref={panelRef}
          onScroll={handleIngredientPanelScroll}
          className={`${dense ? "flex-1" : "max-h-[28rem]"} overflow-y-auto overscroll-contain touch-pan-y pr-1 space-y-3`}
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
    <div className="max-w-5xl mx-auto pb-32">
      {showCookPrompt && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 px-4 pb-24 sm:pb-0">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2 text-brand-600">
              <UtensilsCrossed size={20} />
              <h2 className="text-base font-semibold text-gray-900">
                Cooking this today?
              </h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Tap Yes to log that you made{" "}
              <span className="font-medium text-gray-700">{recipe.name}</span> today.
              This is what tracks when you last made it.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowCookPrompt(false)}
                className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                No, just browsing
              </button>
              <button
                type="button"
                onClick={confirmCookedToday}
                disabled={cookLogState === "logging"}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-60"
              >
                {cookLogState === "logging" && (
                  <Loader2 size={15} className="animate-spin" />
                )}
                Yes, cooking it
              </button>
            </div>
          </div>
        </div>
      )}

      {cookLogState === "logged" && (
        <div className="fixed inset-x-0 top-4 z-[55] flex justify-center px-4 pointer-events-none">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-900/95 px-4 py-2 text-xs text-white shadow-lg">
            <Check size={14} className="text-brand-300" />
            Logged for today
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/recipes/${id}`}
          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{recipe.name}</h1>
          <p className="text-xs text-gray-400">
            Step {currentStep + 1} of {totalSteps} ·{" "}
            {showSourceSteps ? "Source steps" : "Cooking steps"}
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
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(
            [
              { value: "steps", label: "Steps", icon: List },
              { value: "table", label: "Table", icon: Table2 },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setCookingView(value)}
              aria-pressed={cookingView === value}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                cookingView === value
                  ? "bg-brand-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {hasDistinctSourceSteps && (
          <button
            type="button"
            onClick={() => setShowSourceSteps((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
              showSourceSteps
                ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                : "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100"
            }`}
          >
            {showSourceSteps ? "Show cooking steps" : "Show source steps"}
          </button>
        )}

        {hasSourceSteps && !hasDistinctSourceSteps && (
          <span className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500">
            Source and cooking steps are the same
          </span>
        )}

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
            {currentStepTimerPresets.length === 1 ? "" : "s"} ready
          </span>
        )}
      </div>

      {wakeLockError && (
        <p className="text-xs text-red-600 mb-4">{wakeLockError}</p>
      )}

      <GlobalTimerTray className="mb-6" suggestedTimers={suggestedStepTimers} />

      {cookingView === "table" && (
        <div className="mb-4">
          <div className="mb-4 sm:max-w-xs">{renderQuantityScaleControls()}</div>

          <RecipeTableView
            recipeId={recipe.id}
            recipeUpdatedAt={recipe.updatedAt}
            stepSourceKey={stepSourceKey}
            ingredients={recipeIngredients}
            steps={recipeSteps}
            firstStepById={firstMentionStepById}
            quantityScale={quantityScale}
            currentStep={currentStep}
            onSelectStep={setCurrentStep}
          />
        </div>
      )}

      <div
        className={`flex flex-col lg:flex-row gap-6 ${
          cookingView === "table" ? "hidden" : ""
        }`}
      >
        <div className="flex-1">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-4">
            <div className="flex items-start gap-4">
              <span className="shrink-0 w-10 h-10 rounded-full bg-brand-500 text-white text-lg font-bold flex items-center justify-center">
                {currentStep + 1}
              </span>
              <p className="text-gray-800 text-lg leading-relaxed pt-1">{highlightedStep}</p>
            </div>
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

        </div>

        <div className="hidden lg:block lg:w-80 shrink-0">
          {renderIngredientPanel(desktopIngredientPanelRef, desktopCurrentStepSectionRef)}
        </div>
      </div>

      {cookingView === "steps" && (
        <div
          className="fixed inset-x-0 z-40 px-4"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
        >
          <div className="mx-auto max-w-5xl lg:pr-[21.5rem]">
            <div className="rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/80">
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
          </div>
        </div>
      )}

      {cookingView === "steps" && !mobileIngredientsOpen && (
        <button
          type="button"
          onClick={() => setMobileIngredientsOpen(true)}
          className="lg:hidden fixed right-4 z-40 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur supports-[backdrop-filter]:bg-white/80"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 9.5rem)" }}
        >
          Ingredients
          <ChevronLeft size={16} />
        </button>
      )}

      {mobileIngredientsOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/35 overscroll-contain"
          onClick={() => setMobileIngredientsOpen(false)}
        >
          <aside
            className="absolute right-0 top-0 h-full w-[88vw] max-w-sm bg-white p-4 overflow-hidden flex flex-col overscroll-contain shadow-xl"
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
            <div className="min-h-0 flex-1">
              {renderIngredientPanel(mobileIngredientPanelRef, mobileCurrentStepSectionRef, true)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
