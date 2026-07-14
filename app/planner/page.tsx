"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  CookLogEntry,
  MealPlanEntry,
  MealSlot,
  MEAL_SLOTS,
  Recipe,
  RecipeRating,
} from "@/lib/types";
import {
  getRecipes,
  getShoppingList,
  getWeeklyPlanIds,
  saveShoppingList,
  setWeeklyPlanIds,
} from "@/lib/storage";
import { getCookLogs } from "@/lib/cookLog";
import { averageRating, getDisplayName, getRecipeRatings } from "@/lib/ratings";
import { buildPreservedShoppingList } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import {
  addDaysToKey,
  addMealPlanEntry,
  computeRecipeMealStats,
  formatDaysSinceMadeShort,
  getMealPlanEntries,
  moveMealPlanEntry,
  NEVER_MADE_STATS,
  parseDateKey,
  removeMealPlanEntry,
  startOfWeekKey,
  todayKey,
} from "@/lib/mealPlan";
import {
  buildRecipeMetrics,
  CRITERIA_BY_ID,
  CriterionId,
  FilterOperator,
  isCriterionId,
  PoolFilter,
  RECIPE_CRITERIA,
  RecipeCriterion,
  RecipeMetrics,
  recipePassesFilter,
} from "@/lib/recipeCriteria";
import PageLoadingScreen from "@/components/PageLoadingScreen";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  ListChecks,
  Moon,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sun,
  UtensilsCrossed,
  X,
} from "lucide-react";

// The plot's rating axis/filter can use the household average or one person's ratings.
const AVERAGE_RATING_SOURCE = "average";

const SLOT_LABELS: Record<MealSlot, string> = { lunch: "Lunch", dinner: "Dinner" };

const POOL_SETTINGS_KEY = "cooking-be-easy-planner-pool";

type PoolMode = "filters" | "manual";

interface StoredPoolSettings {
  mode: PoolMode;
  filters: PoolFilter[];
  manualIds: string[];
  xAxisId: CriterionId;
  yAxisId: CriterionId;
  ratingSource: string; // "average" or a user id
}

// Sensible starting point when a criterion is first added as a filter
const FILTER_DEFAULTS: Record<CriterionId, { operator: FilterOperator; value: number }> = {
  daysSinceMade: { operator: "gte", value: 3 },
  rating: { operator: "gte", value: 4 },
  timesMade: { operator: "gte", value: 1 },
  ingredientCount: { operator: "lte", value: 12 },
  daysInLibrary: { operator: "lte", value: 30 },
};

interface DragSource {
  recipeId: string;
  entryId: string | null; // set when dragging a chip that is already planned
}

interface DragState extends DragSource {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean; // pointer moved past the tap threshold
}

// --- Plot geometry ---

const NULL_BAND_FRACTION = 0.16;

interface AxisTick {
  fraction: number; // 0..1 along the axis, 0 = low end
  label: string;
}

interface AxisLayout {
  criterion: RecipeCriterion;
  ticks: AxisTick[];
  hasNullBand: boolean;
  nullBandCenter: number;
  bandBoundary: number;
  positionFor: (value: number | null) => number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function niceCeil(value: number): number {
  if (value <= 4) return Math.max(1, Math.ceil(value));
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const fraction = value / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

// Deterministic nudge so chips sharing a spot fan out instead of stacking
function jitterOffset(index: number): { dx: number; dy: number } {
  if (index === 0) return { dx: 0, dy: 0 };
  const step = Math.ceil(index / 2);
  const sign = index % 2 === 1 ? 1 : -1;
  return { dx: sign * step * 2.5, dy: sign * step * 7 };
}

function buildAxisLayout(
  criterion: RecipeCriterion,
  values: Array<number | null>
): AxisLayout {
  const finiteValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  const hasNullBand = criterion.nullSide !== null && values.some((value) => value === null);

  let low: number;
  let high: number;
  if (criterion.fixedDomain) {
    [low, high] = criterion.fixedDomain;
  } else {
    low = Math.min(0, ...finiteValues);
    high = niceCeil(Math.max(criterion.minDomainMax ?? 1, ...finiteValues));
  }
  if (high <= low) high = low + 1;

  const regionStart = hasNullBand && criterion.nullSide === "low" ? NULL_BAND_FRACTION : 0;
  const regionEnd = hasNullBand && criterion.nullSide === "high" ? 1 - NULL_BAND_FRACTION : 1;
  const nullBandCenter =
    criterion.nullSide === "low" ? NULL_BAND_FRACTION / 2 : 1 - NULL_BAND_FRACTION / 2;
  const bandBoundary =
    criterion.nullSide === "low" ? NULL_BAND_FRACTION : 1 - NULL_BAND_FRACTION;

  const positionFor = (value: number | null): number => {
    if (value === null) return nullBandCenter;
    const t = clamp((value - low) / (high - low), 0, 1);
    return regionStart + t * (regionEnd - regionStart);
  };

  const ticks: AxisTick[] = [];
  for (let i = 0; i <= 4; i += 1) {
    const value = low + ((high - low) * i) / 4;
    const label = criterion.formatTick(value);
    if (ticks.length > 0 && ticks[ticks.length - 1].label === label) continue;
    ticks.push({ fraction: regionStart + (i / 4) * (regionEnd - regionStart), label });
  }

  return { criterion, ticks, hasNullBand, nullBandCenter, bandBoundary, positionFor };
}

// --- Misc helpers ---

function slotKeyFor(dateKey: string, slot: MealSlot): string {
  return `${dateKey}|${slot}`;
}

function splitSlotKey(slotKey: string): { dateKey: string; slot: MealSlot } | null {
  const [dateKey, slot] = slotKey.split("|");
  if (!dateKey || (slot !== "lunch" && slot !== "dinner")) return null;
  return { dateKey, slot };
}

function findSlotKeyAtPoint(x: number, y: number): string | null {
  if (typeof document === "undefined") return null;
  const element = document.elementFromPoint(x, y);
  const slotElement = element?.closest?.("[data-slot-key]");
  return slotElement?.getAttribute("data-slot-key") ?? null;
}

function formatWeekRange(weekStartKey: string): string {
  const format = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${format(parseDateKey(weekStartKey))} – ${format(
    parseDateKey(addDaysToKey(weekStartKey, 6))
  )}`;
}

function loadStoredPoolSettings(): Partial<StoredPoolSettings> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(POOL_SETTINGS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Record<string, unknown>;
    const settings: Partial<StoredPoolSettings> = {};

    if (candidate.mode === "filters" || candidate.mode === "manual") {
      settings.mode = candidate.mode;
    }
    if (isCriterionId(candidate.xAxisId)) settings.xAxisId = candidate.xAxisId;
    if (isCriterionId(candidate.yAxisId)) settings.yAxisId = candidate.yAxisId;
    if (typeof candidate.ratingSource === "string") {
      settings.ratingSource = candidate.ratingSource;
    }
    if (Array.isArray(candidate.manualIds)) {
      settings.manualIds = candidate.manualIds.filter(
        (id): id is string => typeof id === "string"
      );
    }
    if (Array.isArray(candidate.filters)) {
      settings.filters = candidate.filters.flatMap((row): PoolFilter[] => {
        if (!row || typeof row !== "object") return [];
        const filter = row as Record<string, unknown>;
        if (!isCriterionId(filter.criterionId)) return [];
        if (filter.operator !== "gte" && filter.operator !== "lte") return [];
        if (typeof filter.value !== "number" || !Number.isFinite(filter.value)) return [];
        return [
          {
            id: typeof filter.id === "string" ? filter.id : uuidv4(),
            criterionId: filter.criterionId,
            operator: filter.operator,
            value: filter.value,
          },
        ];
      });
    }

    return settings;
  } catch {
    return null;
  }
}

export default function PlannerPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [cookLogs, setCookLogs] = useState<CookLogEntry[]>([]);
  const [ratings, setRatings] = useState<RecipeRating[]>([]);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);
  const [weekStartKey, setWeekStartKey] = useState(() => startOfWeekKey(todayKey()));
  const [addingToShopping, setAddingToShopping] = useState(false);
  const [shoppingMessage, setShoppingMessage] = useState<string | null>(null);

  // Lazy-init from localStorage: the first render is just the loading screen
  // on server and client alike, so reading client-only state here can't cause
  // a hydration mismatch — and it keeps the save effect from ever writing
  // defaults over the stored settings.
  const [storedSettings] = useState(() => loadStoredPoolSettings());
  const [poolMode, setPoolMode] = useState<PoolMode>(storedSettings?.mode ?? "filters");
  const [filters, setFilters] = useState<PoolFilter[]>(storedSettings?.filters ?? []);
  const [manualIds, setManualIds] = useState<Set<string>>(
    () => new Set(storedSettings?.manualIds ?? [])
  );
  const [xAxisId, setXAxisId] = useState<CriterionId>(
    storedSettings?.xAxisId ?? "daysSinceMade"
  );
  const [yAxisId, setYAxisId] = useState<CriterionId>(storedSettings?.yAxisId ?? "rating");
  const [ratingSource, setRatingSource] = useState<string>(
    storedSettings?.ratingSource ?? AVERAGE_RATING_SOURCE
  );
  const [manualPickerOpen, setManualPickerOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const manualPickerRef = useRef<HTMLDivElement | null>(null);

  // Drag state lives in a ref (pointer handlers need the latest value without
  // re-render races); dragView mirrors it for rendering the ghost/highlights.
  const dragRef = useRef<DragState | null>(null);
  const [dragView, setDragView] = useState<DragState | null>(null);
  const [hoverSlotKey, setHoverSlotKey] = useState<string | null>(null);
  const [pendingPlace, setPendingPlace] = useState<DragSource | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const [recipesResult, entriesResult, cookLogsResult, ratingsResult] =
        await Promise.allSettled([
          getRecipes(),
          getMealPlanEntries(),
          getCookLogs(),
          getRecipeRatings(),
        ]);

      if (!mounted) return;

      if (recipesResult.status === "fulfilled") setRecipes(recipesResult.value);
      if (cookLogsResult.status === "fulfilled") setCookLogs(cookLogsResult.value);
      if (ratingsResult.status === "fulfilled") setRatings(ratingsResult.value);
      if (entriesResult.status === "fulfilled") {
        setEntries(entriesResult.value);
      } else {
        setPlanLoadFailed(true);
      }
      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  // Persist pool settings on every change
  useEffect(() => {
    if (typeof window === "undefined") return;
    const settings: StoredPoolSettings = {
      mode: poolMode,
      filters,
      manualIds: Array.from(manualIds),
      xAxisId,
      yAxisId,
      ratingSource,
    };
    window.localStorage.setItem(POOL_SETTINGS_KEY, JSON.stringify(settings));
  }, [poolMode, filters, manualIds, xAxisId, yAxisId, ratingSource]);

  // Close the manual picker on outside clicks
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        manualPickerRef.current &&
        !manualPickerRef.current.contains(event.target as Node)
      ) {
        setManualPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  // Escape cancels tap-to-place
  useEffect(() => {
    if (!pendingPlace) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPendingPlace(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingPlace]);

  const today = todayKey();

  const recipesById = useMemo(
    () => Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes]
  );

  // "Made" history now comes solely from cook logs (logged from cooking mode).
  const statsByRecipeId = useMemo(
    () =>
      computeRecipeMealStats(
        cookLogs.map((log) => ({ recipeId: log.recipeId, date: log.cookedOn })),
        today
      ),
    [cookLogs, today]
  );

  const ratingsByRecipeId = useMemo(() => {
    const map = new Map<string, RecipeRating[]>();
    for (const rating of ratings) {
      const list = map.get(rating.recipeId);
      if (list) {
        list.push(rating);
      } else {
        map.set(rating.recipeId, [rating]);
      }
    }
    return map;
  }, [ratings]);

  // Options for the plot's rating source: the household average, then each
  // distinct rater (current user always available, even before they've rated).
  const raterOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [
      { id: AVERAGE_RATING_SOURCE, label: "Average" },
    ];
    const myId = user?.id ?? null;
    const seen = new Set<string>();

    if (myId) {
      const myName = getDisplayName(user);
      options.push({ id: myId, label: myName ? `${myName} (you)` : "You" });
      seen.add(myId);
    }

    const others = new Map<string, string>();
    for (const rating of ratings) {
      if (seen.has(rating.userId) || others.has(rating.userId)) continue;
      others.set(rating.userId, rating.userName ?? "Household member");
    }
    Array.from(others.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: "base" }))
      .forEach(([id, label]) => options.push({ id, label }));

    return options;
  }, [ratings, user]);

  const resolvedRatingFor = useMemo(() => {
    return (recipeId: string): number | null => {
      const recipeRatings = ratingsByRecipeId.get(recipeId) ?? [];
      if (ratingSource === AVERAGE_RATING_SOURCE) {
        return averageRating(recipeRatings);
      }
      return (
        recipeRatings.find((rating) => rating.userId === ratingSource)?.rating ?? null
      );
    };
  }, [ratingsByRecipeId, ratingSource]);

  const nowMs = useMemo(() => Date.now(), []);

  const metricsByRecipeId = useMemo(() => {
    const map = new Map<string, RecipeMetrics>();
    for (const recipe of recipes) {
      const stats = statsByRecipeId[recipe.id] ?? NEVER_MADE_STATS;
      map.set(
        recipe.id,
        buildRecipeMetrics(recipe, stats, resolvedRatingFor(recipe.id), nowMs)
      );
    }
    return map;
  }, [recipes, statsByRecipeId, resolvedRatingFor, nowMs]);

  const weekDayKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStartKey, i)),
    [weekStartKey]
  );

  const entriesBySlotKey = useMemo(() => {
    const map = new Map<string, MealPlanEntry[]>();
    for (const entry of entries) {
      const key = slotKeyFor(entry.planDate, entry.slot);
      const list = map.get(key);
      if (list) {
        list.push(entry);
      } else {
        map.set(key, [entry]);
      }
    }
    return map;
  }, [entries]);

  const weekMealCount = useMemo(() => {
    const weekEndKey = addDaysToKey(weekStartKey, 6);
    return entries.filter(
      (entry) => entry.planDate >= weekStartKey && entry.planDate <= weekEndKey
    ).length;
  }, [entries, weekStartKey]);

  const statsFor = (recipeId: string) => statsByRecipeId[recipeId] ?? NEVER_MADE_STATS;

  const poolRecipes = useMemo(() => {
    if (poolMode === "manual") {
      return recipes.filter((recipe) => manualIds.has(recipe.id));
    }
    return recipes.filter((recipe) => {
      const metrics = metricsByRecipeId.get(recipe.id);
      if (!metrics) return false;
      return filters.every((filter) => recipePassesFilter(metrics, filter));
    });
  }, [recipes, poolMode, manualIds, filters, metricsByRecipeId]);

  const plotLayout = useMemo(() => {
    const xCriterion = CRITERIA_BY_ID[xAxisId];
    const yCriterion = CRITERIA_BY_ID[yAxisId];

    // Axes like Rating leave value-less recipes (e.g. unrated) off the plot
    // instead of parking them in a null band. Pool membership is untouched — a
    // hidden recipe is still counted and still added by "Add all to shopping".
    const hideNullAxes = [xCriterion, yCriterion].filter(
      (criterion) => criterion.hideNullOnPlot
    );
    const plottable = poolRecipes.filter((recipe) => {
      if (hideNullAxes.length === 0) return true;
      const metrics = metricsByRecipeId.get(recipe.id);
      if (!metrics) return false;
      return hideNullAxes.every((criterion) => criterion.getValue(metrics) !== null);
    });

    const sorted = [...plottable].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    const xValues = sorted.map((recipe) =>
      metricsByRecipeId.has(recipe.id)
        ? xCriterion.getValue(metricsByRecipeId.get(recipe.id)!)
        : null
    );
    const yValues = sorted.map((recipe) =>
      metricsByRecipeId.has(recipe.id)
        ? yCriterion.getValue(metricsByRecipeId.get(recipe.id)!)
        : null
    );

    const xAxis = buildAxisLayout(xCriterion, xValues);
    const yAxis = buildAxisLayout(yCriterion, yValues);

    const buckets = new Map<string, number>();
    const points = sorted.map((recipe, i) => {
      const rawX = clamp(xAxis.positionFor(xValues[i]) * 100, 3, 97);
      const rawTop = clamp((1 - yAxis.positionFor(yValues[i])) * 100, 7, 93);
      const bucketKey = `${Math.round(rawX / 8)}|${Math.round(rawTop / 11)}`;
      const bucketIndex = buckets.get(bucketKey) ?? 0;
      buckets.set(bucketKey, bucketIndex + 1);
      const { dx, dy } = jitterOffset(bucketIndex);
      return {
        recipe,
        xPct: clamp(rawX + dx, 2, 98),
        topPct: clamp(rawTop + dy, 4, 96),
      };
    });

    return { xAxis, yAxis, points };
  }, [poolRecipes, metricsByRecipeId, xAxisId, yAxisId]);

  const manualPickerRecipes = useMemo(() => {
    const query = manualQuery.trim().toLowerCase();
    const matching = query
      ? recipes.filter((recipe) => recipe.name.toLowerCase().includes(query))
      : recipes;
    return [...matching].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [recipes, manualQuery]);

  // --- Plan mutations (optimistic; writes mirror the rest of the app) ---

  async function placeRecipe(source: DragSource, dateKey: string, slot: MealSlot) {
    setPendingPlace(null);

    const slotEntries = entriesBySlotKey.get(slotKeyFor(dateKey, slot)) ?? [];
    const isDuplicate = slotEntries.some(
      (entry) => entry.recipeId === source.recipeId && entry.id !== source.entryId
    );
    if (isDuplicate) return;

    if (source.entryId) {
      const entryId = source.entryId;
      const existing = entries.find((entry) => entry.id === entryId);
      if (!existing || (existing.planDate === dateKey && existing.slot === slot)) return;
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId ? { ...entry, planDate: dateKey, slot } : entry
        )
      );
      await moveMealPlanEntry(entryId, dateKey, slot);
    } else {
      const entry: MealPlanEntry = {
        id: uuidv4(),
        recipeId: source.recipeId,
        planDate: dateKey,
        slot,
      };
      setEntries((prev) => [...prev, entry]);
      await addMealPlanEntry(entry);
    }
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
    setPendingPlace((prev) => (prev?.entryId === id ? null : prev));
    void removeMealPlanEntry(id);
  }

  // Adds every recipe currently shown in the pool to the shopping list,
  // merging with (not replacing) whatever is already selected there.
  async function addPoolToShopping() {
    if (addingToShopping || poolRecipes.length === 0) return;
    setAddingToShopping(true);
    setShoppingMessage(null);
    try {
      const [existingList, existingIds] = await Promise.all([
        getShoppingList(),
        getWeeklyPlanIds(),
      ]);
      const poolIds = poolRecipes.map((recipe) => recipe.id);
      const mergedIds = Array.from(new Set([...existingIds, ...poolIds]));
      const addedCount = mergedIds.length - existingIds.length;
      const nextList = buildPreservedShoppingList(mergedIds, recipesById, existingList);
      await Promise.all([setWeeklyPlanIds(mergedIds), saveShoppingList(nextList)]);
      setShoppingMessage(
        addedCount === 0
          ? "Those recipes are already on your shopping list."
          : `Added ${addedCount} recipe${addedCount === 1 ? "" : "s"} to your shopping list.`
      );
    } catch {
      setShoppingMessage("Couldn't update the shopping list. Please try again.");
    } finally {
      setAddingToShopping(false);
    }
  }

  // --- Chip drag / tap-to-place ---

  function syncDrag(next: DragState | null) {
    dragRef.current = next;
    setDragView(next);
  }

  function beginChipDrag(event: React.PointerEvent<HTMLElement>, source: DragSource) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // capture is a nicety — the drag still works while the pointer
      // stays over the chip, so carry on without it
    }
    syncDrag({
      ...source,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    });
  }

  function handleChipPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const distance = Math.hypot(
      event.clientX - current.startX,
      event.clientY - current.startY
    );
    const active = current.active || distance > 7;
    syncDrag({ ...current, x: event.clientX, y: event.clientY, active });
    setHoverSlotKey(active ? findSlotKeyAtPoint(event.clientX, event.clientY) : null);
  }

  function handleChipPointerUp(event: React.PointerEvent<HTMLElement>, source: DragSource) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    syncDrag(null);
    setHoverSlotKey(null);

    if (current.active) {
      const slotKey = findSlotKeyAtPoint(event.clientX, event.clientY);
      const target = slotKey ? splitSlotKey(slotKey) : null;
      if (target) void placeRecipe(source, target.dateKey, target.slot);
      return;
    }

    // Treat as a tap: toggle place-mode selection
    setPendingPlace((prev) =>
      prev && prev.recipeId === source.recipeId && prev.entryId === source.entryId
        ? null
        : source
    );
  }

  function handleChipPointerCancel(event: React.PointerEvent<HTMLElement>) {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    syncDrag(null);
    setHoverSlotKey(null);
  }

  function handleSlotClick(dateKey: string, slot: MealSlot) {
    if (!pendingPlace || dragRef.current) return;
    void placeRecipe(pendingPlace, dateKey, slot);
  }

  // --- Pool controls ---

  function addFilter() {
    const usedIds = new Set(filters.map((filter) => filter.criterionId));
    const criterion =
      RECIPE_CRITERIA.find((candidate) => !usedIds.has(candidate.id)) ?? RECIPE_CRITERIA[0];
    const defaults = FILTER_DEFAULTS[criterion.id];
    setFilters((prev) => [
      ...prev,
      { id: uuidv4(), criterionId: criterion.id, ...defaults },
    ]);
  }

  function updateFilter(id: string, patch: Partial<Omit<PoolFilter, "id">>) {
    setFilters((prev) =>
      prev.map((filter) => {
        if (filter.id !== id) return filter;
        // Switching criterion resets operator/value to that criterion's defaults
        if (patch.criterionId && patch.criterionId !== filter.criterionId) {
          return { id: filter.id, criterionId: patch.criterionId, ...FILTER_DEFAULTS[patch.criterionId] };
        }
        return { ...filter, ...patch };
      })
    );
  }

  function removeFilter(id: string) {
    setFilters((prev) => prev.filter((filter) => filter.id !== id));
  }

  function toggleManualId(recipeId: string) {
    setManualIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  }

  function selectAllVisibleManual() {
    setManualIds((prev) => {
      const next = new Set(prev);
      for (const recipe of manualPickerRecipes) next.add(recipe.id);
      return next;
    });
  }

  if (loading) {
    return <PageLoadingScreen label="Loading meal plan" />;
  }

  const isCurrentWeek = weekStartKey === startOfWeekKey(today);
  const draggedRecipe = dragView?.active ? recipesById[dragView.recipeId] : undefined;
  const pendingRecipe = pendingPlace ? recipesById[pendingPlace.recipeId] : undefined;
  const { xAxis, yAxis, points } = plotLayout;
  // Pool recipes dropped from the plot because they have no value on a
  // hide-null axis (today: unrated dishes when Rating is an axis).
  const hiddenUnratedCount = poolRecipes.length - points.length;
  const ratingInUse =
    xAxisId === "rating" ||
    yAxisId === "rating" ||
    filters.some((filter) => filter.criterionId === "rating");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meal Planner</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {weekMealCount === 0
              ? "Drag recipes from the pool into lunch and dinner slots."
              : `${weekMealCount} meal${weekMealCount === 1 ? "" : "s"} planned this week`}
          </p>
        </div>
        <button
          type="button"
          onClick={addPoolToShopping}
          disabled={addingToShopping || poolRecipes.length === 0}
          title="Add every recipe currently shown in the pool to your shopping list"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          <ShoppingCart size={15} />
          <span className="hidden sm:inline">Add all to shopping</span>
          <span className="sm:hidden">Add all</span>
        </button>
      </div>

      {shoppingMessage && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-800">
          <span>{shoppingMessage}</span>
          <a href="/shopping" className="font-medium text-brand-700 hover:underline shrink-0">
            View list
          </a>
        </div>
      )}

      {planLoadFailed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn&apos;t load the meal plan. If this is a fresh setup, run the new
          migration in the Supabase SQL editor:{" "}
          <code className="text-xs">supabase/migrations/20260707000000_add_meal_planner.sql</code>
        </div>
      )}

      {/* Week calendar */}
      <section className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekStartKey(addDaysToKey(weekStartKey, -7))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
              aria-label="Previous week"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setWeekStartKey(addDaysToKey(weekStartKey, 7))}
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
              aria-label="Next week"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="text-sm font-semibold text-gray-800">
            {formatWeekRange(weekStartKey)}
          </span>
          {isCurrentWeek ? (
            <span className="text-xs text-gray-400 px-2.5 py-1.5">This week</span>
          ) : (
            <button
              type="button"
              onClick={() => setWeekStartKey(startOfWeekKey(todayKey()))}
              className="text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2.5 py-1.5 hover:bg-brand-100 transition-colors"
            >
              This week
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {weekDayKeys.map((dayKey) => {
            const date = parseDateKey(dayKey);
            const isToday = dayKey === today;
            const isPast = dayKey < today;

            return (
              <div
                key={dayKey}
                className={`rounded-xl border p-2 ${
                  isToday ? "border-brand-300 bg-brand-50/40" : "border-gray-200"
                }`}
              >
                <div
                  className={`flex items-baseline gap-1.5 px-0.5 pb-1.5 sm:flex-col sm:gap-0 ${
                    isPast ? "opacity-60" : ""
                  }`}
                >
                  <span
                    className={`text-sm font-semibold ${
                      isToday ? "text-brand-700" : "text-gray-700"
                    }`}
                  >
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <span className={`text-xs ${isToday ? "text-brand-600" : "text-gray-400"}`}>
                    {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-1.5">
                  {MEAL_SLOTS.map((slot) => {
                    const slotKey = slotKeyFor(dayKey, slot);
                    const slotEntries = entriesBySlotKey.get(slotKey) ?? [];
                    const isDropTarget = hoverSlotKey === slotKey;

                    return (
                      <div
                        key={slot}
                        data-slot-key={slotKey}
                        onClick={() => handleSlotClick(dayKey, slot)}
                        className={`rounded-lg border p-2 min-h-[5.25rem] transition-colors ${
                          isDropTarget
                            ? "border-brand-400 bg-brand-100 ring-2 ring-brand-300"
                            : pendingPlace
                              ? "border-dashed border-brand-300 bg-brand-50/50 cursor-pointer"
                              : "border-gray-100 bg-gray-50/70"
                        }`}
                      >
                        <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 pointer-events-none">
                          {slot === "lunch" ? <Sun size={11} /> : <Moon size={11} />}
                          {SLOT_LABELS[slot]}
                        </div>
                        <div className="mt-1.5 space-y-1.5">
                          {slotEntries.map((entry) => {
                            const recipe = recipesById[entry.recipeId];
                            const isSelected = pendingPlace?.entryId === entry.id;
                            const isBeingDragged =
                              dragView?.active && dragView.entryId === entry.id;

                            return (
                              <div
                                key={entry.id}
                                onPointerDown={(event) =>
                                  beginChipDrag(event, {
                                    recipeId: entry.recipeId,
                                    entryId: entry.id,
                                  })
                                }
                                onPointerMove={handleChipPointerMove}
                                onPointerUp={(event) =>
                                  handleChipPointerUp(event, {
                                    recipeId: entry.recipeId,
                                    entryId: entry.id,
                                  })
                                }
                                onPointerCancel={handleChipPointerCancel}
                                onClick={(event) => event.stopPropagation()}
                                onContextMenu={(event) => event.preventDefault()}
                                title={recipe?.name ?? undefined}
                                className={`relative overflow-hidden rounded-lg border cursor-grab touch-none select-none transition-opacity ${
                                  isSelected
                                    ? "border-brand-400 ring-1 ring-brand-400"
                                    : "border-brand-100"
                                } ${isBeingDragged ? "opacity-40" : ""}`}
                              >
                                {recipe?.dishPhotos[0] ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={recipe.dishPhotos[0]}
                                    alt=""
                                    draggable={false}
                                    className="h-14 w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-14 w-full items-center justify-center bg-brand-100/50">
                                    <ImageIcon size={18} className="text-brand-300" />
                                  </div>
                                )}
                                <div
                                  className={`truncate px-1.5 py-1 text-[11px] font-medium leading-tight ${
                                    isSelected
                                      ? "bg-brand-100 text-brand-900"
                                      : "bg-brand-50 text-brand-800"
                                  }`}
                                >
                                  {recipe?.name ?? "Recipe"}
                                </div>
                                <button
                                  type="button"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeEntry(entry.id);
                                  }}
                                  className="absolute right-1 top-1 rounded-full bg-white/85 p-0.5 text-gray-500 shadow-sm hover:text-red-500 transition-colors"
                                  aria-label={`Remove ${recipe?.name ?? "recipe"}`}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recipe pool */}
      <section className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recipe pool</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {poolRecipes.length} of {recipes.length} recipe
              {recipes.length === 1 ? "" : "s"} shown · drag a chip onto a slot, or tap
              it and then tap a slot
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium">
            {(["filters", "manual"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPoolMode(mode)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
                  poolMode === mode
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {mode === "filters" ? (
                  <SlidersHorizontal size={13} />
                ) : (
                  <ListChecks size={13} />
                )}
                {mode === "filters" ? "Filters" : "Manual"}
              </button>
            ))}
          </div>
        </div>

        {poolMode === "filters" ? (
          <div className="space-y-2">
            {filters.length === 0 && (
              <p className="text-xs text-gray-400">
                No filters — every recipe is in the pool. Add one to hide recipes, e.g.
                anything made in the last 3 days or rated under 4 stars.
              </p>
            )}
            {filters.map((filter) => {
              const criterion = CRITERIA_BY_ID[filter.criterionId];
              return (
                <div key={filter.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">Show if</span>
                  <select
                    value={filter.criterionId}
                    onChange={(event) =>
                      updateFilter(filter.id, {
                        criterionId: event.target.value as CriterionId,
                      })
                    }
                    className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    aria-label="Filter criterion"
                  >
                    {RECIPE_CRITERIA.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filter.operator}
                    onChange={(event) =>
                      updateFilter(filter.id, {
                        operator: event.target.value as FilterOperator,
                      })
                    }
                    className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    aria-label="Filter comparison"
                  >
                    <option value="gte">is at least</option>
                    <option value="lte">is at most</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={filter.value}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      updateFilter(filter.id, {
                        value: Number.isFinite(parsed) ? parsed : 0,
                      });
                    }}
                    className="h-9 w-20 rounded-lg border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    aria-label="Filter value"
                  />
                  <span className="text-xs text-gray-400">{criterion.unit}</span>
                  <button
                    type="button"
                    onClick={() => removeFilter(filter.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    aria-label="Remove filter"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addFilter}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800 transition-colors"
            >
              <Plus size={14} />
              Add filter
            </button>
          </div>
        ) : (
          <div ref={manualPickerRef} className="relative">
            <button
              type="button"
              onClick={() => setManualPickerOpen((value) => !value)}
              className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-700 hover:border-gray-400 transition-colors"
            >
              <span>
                {manualIds.size === 0
                  ? "Choose recipes for the pool"
                  : `${manualIds.size} recipe${manualIds.size === 1 ? "" : "s"} hand-picked`}
              </span>
              <ChevronDown
                size={16}
                className={`text-gray-400 transition-transform ${
                  manualPickerOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {manualPickerOpen && (
              <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                <label className="relative block">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    autoFocus
                    value={manualQuery}
                    onChange={(event) => setManualQuery(event.target.value)}
                    placeholder="Search recipes"
                    className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                  />
                </label>
                <div className="flex items-center gap-3 px-1 pt-2 text-xs font-medium">
                  <button
                    type="button"
                    onClick={selectAllVisibleManual}
                    className="text-brand-700 hover:text-brand-800"
                  >
                    Select all{manualQuery.trim() ? " matches" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualIds(new Set())}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-2 max-h-72 overflow-y-auto">
                  {manualPickerRecipes.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-gray-400">
                      No matching recipes.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {manualPickerRecipes.map((recipe) => {
                        const checked = manualIds.has(recipe.id);
                        const stats = statsFor(recipe.id);
                        return (
                          <button
                            key={recipe.id}
                            type="button"
                            onClick={() => toggleManualId(recipe.id)}
                            className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 transition-colors"
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                                checked
                                  ? "bg-brand-500 border-brand-500"
                                  : "border-gray-300"
                              }`}
                            >
                              {checked && <Check size={11} className="text-white" />}
                            </span>
                            {recipe.dishPhotos[0] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={recipe.dishPhotos[0]}
                                alt=""
                                className="h-7 w-7 shrink-0 rounded-md object-cover"
                              />
                            ) : (
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100">
                                <ImageIcon size={13} className="text-gray-300" />
                              </span>
                            )}
                            <span className="flex-1 min-w-0 truncate text-sm text-gray-800">
                              {recipe.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-gray-400">
                              {formatDaysSinceMadeShort(stats.daysSinceMade)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-11 shrink-0 font-medium">X axis</span>
            <select
              value={xAxisId}
              onChange={(event) => setXAxisId(event.target.value as CriterionId)}
              className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {RECIPE_CRITERIA.map((criterion) => (
                <option key={criterion.id} value={criterion.id}>
                  {criterion.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-11 shrink-0 font-medium">Y axis</span>
            <select
              value={yAxisId}
              onChange={(event) => setYAxisId(event.target.value as CriterionId)}
              className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {RECIPE_CRITERIA.map((criterion) => (
                <option key={criterion.id} value={criterion.id}>
                  {criterion.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {ratingInUse && raterOptions.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="shrink-0 font-medium">Rating uses</span>
            <select
              value={ratingSource}
              onChange={(event) => setRatingSource(event.target.value)}
              className="h-9 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Which rating the plot uses"
            >
              {raterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {hiddenUnratedCount > 0 && points.length > 0 && (
          <p className="text-xs text-gray-400">
            {hiddenUnratedCount} unrated recipe{hiddenUnratedCount === 1 ? "" : "s"} not
            shown on the rating axis.
          </p>
        )}

        {/* The plot */}
        <div>
          <div className="flex items-stretch gap-1.5">
            {/* Y-axis tick labels */}
            <div className="relative w-9 shrink-0 h-[460px] sm:h-[620px]">
              {yAxis.ticks.map((tick) => (
                <span
                  key={`y-${tick.fraction}-${tick.label}`}
                  className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400"
                  style={{ top: `${(1 - tick.fraction) * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
              {yAxis.hasNullBand && (
                <span
                  className="absolute right-1 -translate-y-1/2 text-[9px] italic text-gray-400"
                  style={{ top: `${(1 - yAxis.nullBandCenter) * 100}%` }}
                >
                  {yAxis.criterion.nullLabel}
                </span>
              )}
            </div>

            {/* Plot area */}
            <div className="relative flex-1 h-[460px] sm:h-[620px] rounded-lg border border-gray-200 bg-gray-50/60 overflow-hidden">
              {/* Gridlines */}
              {xAxis.ticks.map((tick) => (
                <div
                  key={`gx-${tick.fraction}-${tick.label}`}
                  className="absolute top-0 bottom-0 w-px bg-gray-200/60"
                  style={{ left: `${tick.fraction * 100}%` }}
                />
              ))}
              {yAxis.ticks.map((tick) => (
                <div
                  key={`gy-${tick.fraction}-${tick.label}`}
                  className="absolute left-0 right-0 h-px bg-gray-200/60"
                  style={{ top: `${(1 - tick.fraction) * 100}%` }}
                />
              ))}
              {xAxis.hasNullBand && (
                <div
                  className="absolute top-0 bottom-0 border-l border-dashed border-gray-300"
                  style={{ left: `${xAxis.bandBoundary * 100}%` }}
                />
              )}
              {yAxis.hasNullBand && (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-gray-300"
                  style={{ top: `${(1 - yAxis.bandBoundary) * 100}%` }}
                />
              )}

              {/* Axis name overlays */}
              <span className="absolute top-1.5 left-2 text-[10px] text-gray-400 pointer-events-none">
                ↑ {yAxis.criterion.label}
              </span>
              <span className="absolute bottom-1.5 right-2 text-[10px] text-gray-400 pointer-events-none">
                {xAxis.criterion.label} →
              </span>

              {points.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                  <UtensilsCrossed size={28} className="text-gray-300" />
                  <p className="text-sm text-gray-400">
                    {recipes.length === 0
                      ? "No recipes saved yet."
                      : hiddenUnratedCount > 0
                        ? `${hiddenUnratedCount} pool recipe${
                            hiddenUnratedCount === 1 ? " is" : "s are"
                          } unrated — nothing to plot on the rating axis.`
                        : poolMode === "manual"
                          ? "No recipes hand-picked yet — choose some above."
                          : "No recipes match the filters."}
                  </p>
                </div>
              )}

              {/* Recipe chips — name + thumbnail only */}
              {points.map(({ recipe, xPct, topPct }) => {
                // Center chips on their point, but anchor ones near the plot
                // edges inward so overflow-hidden doesn't clip their labels
                const anchorX =
                  xPct < 12 ? "translate-x-0" : xPct > 88 ? "-translate-x-full" : "-translate-x-1/2";
                const isSelected =
                  pendingPlace !== null &&
                  pendingPlace.entryId === null &&
                  pendingPlace.recipeId === recipe.id;
                const isBeingDragged =
                  dragView?.active &&
                  dragView.entryId === null &&
                  dragView.recipeId === recipe.id;
                const thumbnail = recipe.dishPhotos[0];

                return (
                  <button
                    key={recipe.id}
                    type="button"
                    onPointerDown={(event) =>
                      beginChipDrag(event, { recipeId: recipe.id, entryId: null })
                    }
                    onPointerMove={handleChipPointerMove}
                    onPointerUp={(event) =>
                      handleChipPointerUp(event, { recipeId: recipe.id, entryId: null })
                    }
                    onPointerCancel={handleChipPointerCancel}
                    onContextMenu={(event) => event.preventDefault()}
                    className={`absolute flex max-w-[168px] ${anchorX} -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border bg-white py-1 pl-1 pr-2.5 text-xs leading-none shadow-sm cursor-grab touch-none select-none transition-shadow hover:shadow-md hover:z-20 ${
                      isSelected
                        ? "border-brand-500 ring-2 ring-brand-300 z-20"
                        : "border-gray-200"
                    } ${isBeingDragged ? "opacity-40" : ""}`}
                    style={{ left: `${xPct}%`, top: `${topPct}%` }}
                  >
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnail}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100">
                        <ImageIcon size={12} className="text-gray-300" />
                      </span>
                    )}
                    <span className="max-w-[120px] truncate font-medium text-gray-800">
                      {recipe.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* X-axis tick labels */}
          <div className="relative mt-1 ml-[42px] h-4">
            {xAxis.ticks.map((tick) => (
              <span
                key={`xl-${tick.fraction}-${tick.label}`}
                className="absolute -translate-x-1/2 text-[10px] text-gray-400"
                style={{ left: `${tick.fraction * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
            {xAxis.hasNullBand && (
              <span
                className="absolute -translate-x-1/2 text-[9px] italic text-gray-400"
                style={{ left: `${xAxis.nullBandCenter * 100}%` }}
              >
                {xAxis.criterion.nullLabel}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Drag ghost */}
      {draggedRecipe && dragView && (
        <div
          className="pointer-events-none fixed z-[100]"
          style={{
            left: dragView.x,
            top: dragView.y,
            transform: "translate(-50%, -130%)",
          }}
        >
          <div className="max-w-[220px] truncate rounded-full bg-gray-900/95 px-3 py-1.5 text-xs text-white shadow-lg">
            {draggedRecipe.name}
          </div>
        </div>
      )}

      {/* Tap-to-place banner */}
      {pendingPlace && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-gray-900/95 py-1.5 pl-4 pr-1.5 text-xs text-white shadow-lg">
            <span className="max-w-[250px] truncate">
              Tap a slot to {pendingPlace.entryId ? "move" : "add"} &ldquo;
              {pendingRecipe?.name ?? "recipe"}&rdquo;
            </span>
            <button
              type="button"
              onClick={() => setPendingPlace(null)}
              className="rounded-full bg-white/10 p-1.5 hover:bg-white/20 transition-colors"
              aria-label="Cancel placing"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
