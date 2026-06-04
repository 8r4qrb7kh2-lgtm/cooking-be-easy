"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GrocerySection,
  GROCERY_SECTIONS,
  Recipe,
  ShoppingListItem,
} from "@/lib/types";
import {
  getRecipes,
  getShoppingList,
  getWeeklyPlanIds,
  saveShoppingList,
  setWeeklyPlanIds,
} from "@/lib/storage";
import { getRecentRecipeViews, RecentRecipeViews } from "@/lib/recentViews";
import { RecipeSortOption, sortRecipes } from "@/lib/recipeSort";
import { groupBySection, mergeIngredients } from "@/lib/utils";
import PageLoadingScreen from "@/components/PageLoadingScreen";
import { v4 as uuidv4 } from "uuid";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  ImageIcon,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";

// Rebuild the shopping list from the selected recipes while preserving the
// user's work: checkmarks on items that still exist, and any manually-added
// items (those not tied to a recipe). This lets the list auto-update on every
// selection change without wiping checked state or hand-entered items.
function buildPreservedShoppingList(
  nextIds: string[],
  recipesById: Record<string, Recipe>,
  prevItems: ShoppingListItem[]
): ShoppingListItem[] {
  const nextRecipes = nextIds
    .map((id) => recipesById[id])
    .filter((recipe): recipe is Recipe => Boolean(recipe));
  const merged = mergeIngredients(nextRecipes);

  const itemKey = (name: string) => name.toLowerCase().trim();
  const prevByKey = new Map(prevItems.map((item) => [itemKey(item.name), item]));
  for (const item of merged) {
    if (prevByKey.get(itemKey(item.name))?.checked) {
      item.checked = true;
    }
  }

  const mergedKeys = new Set(merged.map((item) => itemKey(item.name)));
  const manualItems = prevItems.filter(
    (item) => item.recipeIds.length === 0 && !mergedKeys.has(itemKey(item.name))
  );

  return [...merged, ...manualItems];
}

export default function ShoppingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipePickerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [recipePickerQuery, setRecipePickerQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState({ quantity: "", unit: "", name: "" });
  const [addingSection, setAddingSection] = useState<GrocerySection | null>(null);
  const [newItem, setNewItem] = useState({ name: "", quantity: "", unit: "" });
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<RecipeSortOption>("recently-viewed");
  const [recentViewsByRecipeId, setRecentViewsByRecipeId] =
    useState<RecentRecipeViews>({});
  const [recipesById, setRecipesById] = useState<Record<string, Recipe>>({});

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [shoppingItems, loadedRecipes, loadedSelectedRecipeIds] =
          await Promise.all([getShoppingList(), getRecipes(), getWeeklyPlanIds()]);

        if (!mounted) {
          return;
        }

        setItems(shoppingItems);
        setRecipes(loadedRecipes);
        setSelectedRecipeIds(loadedSelectedRecipeIds);
        setRecipesById(
          Object.fromEntries(loadedRecipes.map((recipe) => [recipe.id, recipe]))
        );
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
    function handlePointerDown(event: MouseEvent) {
      if (
        recipePickerRef.current &&
        !recipePickerRef.current.contains(event.target as Node)
      ) {
        setRecipePickerOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (loading) return;

    const validSelectedRecipeIds = selectedRecipeIds.filter(
      (recipeId) => recipesById[recipeId]
    );

    if (validSelectedRecipeIds.length === selectedRecipeIds.length) {
      return;
    }

    void applySelectedRecipes(validSelectedRecipeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, recipesById, selectedRecipeIds]);

  useEffect(() => {
    if (loading) return;

    const addId = searchParams.get("add");
    if (!addId) return;

    if (!recipesById[addId] || selectedRecipeIds.includes(addId)) {
      router.replace("/shopping");
      return;
    }

    void applySelectedRecipes([...selectedRecipeIds, addId]);
    router.replace("/shopping");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, recipesById, router, searchParams, selectedRecipeIds]);

  async function persist(next: ShoppingListItem[]) {
    setItems(next);
    await saveShoppingList(next);
  }

  // Update the selected recipes and immediately rebuild the shopping list from
  // them — there is no manual "Update list" step.
  async function applySelectedRecipes(nextIds: string[]) {
    const nextList = buildPreservedShoppingList(nextIds, recipesById, items);
    setSelectedRecipeIds(nextIds);
    setItems(nextList);
    setEditingId(null);
    setAddingSection(null);
    await Promise.all([setWeeklyPlanIds(nextIds), saveShoppingList(nextList)]);
  }

  function toggleCheck(id: string) {
    void persist(
      items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  }

  function removeItem(id: string) {
    void persist(items.filter((item) => item.id !== id));
  }

  function startEdit(item: ShoppingListItem) {
    setEditingId(item.id);
    setEditBuf({ quantity: item.quantity, unit: item.unit, name: item.name });
  }

  function saveEdit(id: string) {
    void persist(
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              quantity: editBuf.quantity,
              unit: editBuf.unit,
              name: editBuf.name,
            }
          : item
      )
    );
    setEditingId(null);
  }

  function addItemToSection(section: GrocerySection) {
    if (!newItem.name.trim()) return;

    const item: ShoppingListItem = {
      id: uuidv4(),
      name: newItem.name.trim(),
      quantity: newItem.quantity,
      unit: newItem.unit,
      section,
      recipeIds: [],
      recipeNames: [],
      checked: false,
    };

    void persist([...items, item]);
    setNewItem({ name: "", quantity: "", unit: "" });
    setAddingSection(null);
  }

  function toggleSection(section: string) {
    const next = new Set(collapsedSections);
    if (next.has(section)) {
      next.delete(section);
    } else {
      next.add(section);
    }
    setCollapsedSections(next);
  }

  function clearAll() {
    if (!confirm("Clear all shopping items?")) return;
    void persist([]);
  }

  function addSelectedRecipe(id: string) {
    if (selectedRecipeIds.includes(id)) return;
    setRecipePickerQuery("");
    void applySelectedRecipes([...selectedRecipeIds, id]);
  }

  function removeSelectedRecipe(id: string) {
    void applySelectedRecipes(selectedRecipeIds.filter((recipeId) => recipeId !== id));
  }

  function clearSelectedRecipes() {
    setRecipePickerOpen(false);
    setRecipePickerQuery("");
    void applySelectedRecipes([]);
  }

  function getSortMetricsForItem(item: ShoppingListItem) {
    let recentViewedAt = 0;
    let ratingScore = 0;

    for (const recipeId of item.recipeIds) {
      const recipe = recipesById[recipeId];
      if (!recipe) continue;
      recentViewedAt = Math.max(recentViewedAt, recentViewsByRecipeId[recipeId] ?? 0);
      ratingScore = Math.max(ratingScore, recipe.rating ?? 0);
    }

    return { recentViewedAt, ratingScore };
  }

  const selectedRecipes = useMemo(
    () =>
      selectedRecipeIds
        .map((recipeId) => recipesById[recipeId])
        .filter((recipe): recipe is Recipe => Boolean(recipe)),
    [recipesById, selectedRecipeIds]
  );

  const selectedIngredientCount = useMemo(
    () =>
      selectedRecipes.reduce(
        (sum, recipe) => sum + recipe.ingredients.length,
        0
      ),
    [selectedRecipes]
  );

  const selectableRecipes = useMemo(() => {
    const query = recipePickerQuery.trim().toLowerCase();
    const availableRecipes = recipes.filter(
      (recipe) => !selectedRecipeIds.includes(recipe.id)
    );
    const filteredRecipes = query
      ? availableRecipes.filter((recipe) => {
          const haystack = `${recipe.name} ${recipe.ingredients
            .map((ingredient) => ingredient.name)
            .join(" ")}`.toLowerCase();
          return haystack.includes(query);
        })
      : availableRecipes;

    return sortRecipes(filteredRecipes, "recently-viewed", recentViewsByRecipeId);
  }, [recipePickerQuery, recipes, recentViewsByRecipeId, selectedRecipeIds]);

  const visibleItems = useMemo(() => {
    const query = itemSearchQuery.trim().toLowerCase();
    const filtered = query
      ? items.filter((item) => {
          const haystack = `${item.name} ${item.recipeNames.join(" ")}`.toLowerCase();
          return haystack.includes(query);
        })
      : items;

    return [...filtered].sort((a, b) => {
      const aMetrics = getSortMetricsForItem(a);
      const bMetrics = getSortMetricsForItem(b);

      if (sortOption === "rating-desc") {
        const ratingDiff = bMetrics.ratingScore - aMetrics.ratingScore;
        if (ratingDiff !== 0) return ratingDiff;

        const recentDiff = bMetrics.recentViewedAt - aMetrics.recentViewedAt;
        if (recentDiff !== 0) return recentDiff;
      } else {
        const recentDiff = bMetrics.recentViewedAt - aMetrics.recentViewedAt;
        if (recentDiff !== 0) return recentDiff;

        const ratingDiff = bMetrics.ratingScore - aMetrics.ratingScore;
        if (ratingDiff !== 0) return ratingDiff;
      }

      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [itemSearchQuery, items, recentViewsByRecipeId, recipesById, sortOption]);

  const grouped = groupBySection(visibleItems);
  const checkedCount = items.filter((item) => item.checked).length;
  const totalCount = items.length;
  const visibleCount = visibleItems.length;
  const activeSections = GROCERY_SECTIONS.filter((section) => grouped[section].length > 0);

  if (loading) {
    return <PageLoadingScreen />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shopping List</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {selectedRecipes.length} recipe{selectedRecipes.length === 1 ? "" : "s"} selected
            {` · ${checkedCount}/${totalCount} items checked`}
            {items.length > 0 ? ` · showing ${visibleCount}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalCount > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Trash2 size={13} />
              Clear all
            </button>
          )}
        </div>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Recipes</h2>
            <p className="text-sm text-gray-500 mt-1">
              Search and select recipes — the shopping list updates automatically
              as you add or remove them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedRecipeIds.length > 0 && (
              <button
                type="button"
                onClick={clearSelectedRecipes}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <X size={14} />
                Clear selected
              </button>
            )}
          </div>
        </div>

        {recipes.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
            No recipes saved yet.{" "}
            <Link href="/recipes/new" className="text-brand-700 font-medium hover:underline">
              Add a recipe
            </Link>
            .
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div ref={recipePickerRef} className="relative">
              <button
                type="button"
                onClick={() => setRecipePickerOpen((value) => !value)}
                className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-left text-sm text-gray-700 hover:border-gray-400 transition-colors"
              >
                <span>
                  {selectedRecipes.length === 0
                    ? "Select recipes"
                    : `${selectedRecipes.length} recipe${selectedRecipes.length === 1 ? "" : "s"} selected`}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform ${
                    recipePickerOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {recipePickerOpen && (
                <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                  <label className="relative block">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      autoFocus
                      value={recipePickerQuery}
                      onChange={(event) => setRecipePickerQuery(event.target.value)}
                      placeholder="Search recipes"
                      className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                    />
                  </label>

                  <div className="mt-2 max-h-72 overflow-y-auto">
                    {selectableRecipes.length === 0 ? (
                      <div className="px-3 py-6 text-center text-sm text-gray-400">
                        {recipePickerQuery.trim()
                          ? "No matching recipes."
                          : "All recipes are already selected."}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {selectableRecipes.map((recipe) => (
                          <button
                            key={recipe.id}
                            type="button"
                            onClick={() => addSelectedRecipe(recipe.id)}
                            className="w-full flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50 transition-colors"
                          >
                            {recipe.dishPhotos.length > 0 ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={recipe.dishPhotos[0]}
                                alt={recipe.name}
                                className="w-10 h-10 rounded-lg object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                                <ImageIcon size={16} className="text-gray-300" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {recipe.name}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {recipe.ingredients.length} ingredients
                              </p>
                            </div>
                            <Plus size={16} className="text-gray-300 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedRecipes.length === 0 ? (
              <p className="text-sm text-gray-400">No recipes selected.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {selectedRecipes.map((recipe) => (
                    <button
                      key={recipe.id}
                      type="button"
                      onClick={() => removeSelectedRecipe(recipe.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-100 transition-colors"
                    >
                      <span className="max-w-full truncate">{recipe.name}</span>
                      <X size={14} />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {selectedRecipes.length} recipe
                  {selectedRecipes.length === 1 ? "" : "s"} selected
                  {` · about ${selectedIngredientCount} ingredients before merging`}
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <ShoppingCart size={48} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-lg font-semibold text-gray-500">No shopping list yet</h2>
          <p className="text-sm text-gray-400 mt-1">
            Select recipes above and your list builds automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={itemSearchQuery}
                onChange={(event) => setItemSearchQuery(event.target.value)}
                placeholder="Search shopping items"
                className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
            </label>
            <select
              value={sortOption}
              onChange={(event) =>
                setSortOption(event.target.value as RecipeSortOption)
              }
              className="h-10 text-sm px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              aria-label="Sort shopping items"
            >
              <option value="recently-viewed">Recently viewed</option>
              <option value="rating-desc">Rating: high to low</option>
            </select>
          </div>

          {totalCount > 0 && (
            <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-brand-500 h-2 rounded-full transition-all"
                style={{ width: `${(checkedCount / totalCount) * 100}%` }}
              />
            </div>
          )}

          {visibleItems.length === 0 ? (
            <div className="text-center py-14">
              <h2 className="text-lg font-semibold text-gray-500">No matching items</h2>
              <p className="text-sm text-gray-400 mt-1">Try a different search term.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeSections.map((section) => {
                const sectionItems = grouped[section];
                const collapsed = collapsedSections.has(section);
                const sectionChecked = sectionItems.filter((item) => item.checked).length;

                return (
                  <div
                    key={section}
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                  >
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                      onClick={() => toggleSection(section)}
                    >
                      <div className="flex items-center gap-2">
                        {collapsed ? (
                          <ChevronRight size={16} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-400" />
                        )}
                        <span className="font-semibold text-gray-800 text-sm">{section}</span>
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                          {sectionItems.length}
                        </span>
                      </div>
                      {sectionChecked > 0 && (
                        <span className="text-xs text-brand-600 font-medium">
                          {sectionChecked}/{sectionItems.length}
                        </span>
                      )}
                    </button>

                    {!collapsed && (
                      <ul className="divide-y divide-gray-50">
                        {sectionItems.map((item) => (
                          <li
                            key={item.id}
                            className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                              item.checked ? "bg-gray-50" : ""
                            }`}
                          >
                            <button
                              onClick={() => toggleCheck(item.id)}
                              className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                item.checked
                                  ? "bg-brand-500 border-brand-500"
                                  : "border-gray-300 hover:border-brand-400"
                              }`}
                              aria-label={item.checked ? "Uncheck item" : "Check item"}
                            >
                              {item.checked && (
                                <Check size={13} className="text-white" />
                              )}
                            </button>

                            {editingId === item.id ? (
                              <div className="flex-1 flex gap-2 items-center">
                                <input
                                  className="w-16 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                                  value={editBuf.quantity}
                                  onChange={(event) =>
                                    setEditBuf({
                                      ...editBuf,
                                      quantity: event.target.value,
                                    })
                                  }
                                  placeholder="Qty"
                                />
                                <input
                                  className="w-20 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                                  value={editBuf.unit}
                                  onChange={(event) =>
                                    setEditBuf({
                                      ...editBuf,
                                      unit: event.target.value,
                                    })
                                  }
                                  placeholder="Unit"
                                />
                                <input
                                  className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                                  value={editBuf.name}
                                  onChange={(event) =>
                                    setEditBuf({
                                      ...editBuf,
                                      name: event.target.value,
                                    })
                                  }
                                  placeholder="Name"
                                />
                                <button
                                  onClick={() => saveEdit(item.id)}
                                  className="text-brand-600 hover:text-brand-700"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <div className={`flex-1 min-w-0 ${item.checked ? "opacity-50" : ""}`}>
                                <div className="flex items-baseline gap-1.5">
                                  {(item.quantity || item.unit) && (
                                    <span className="text-sm font-semibold text-brand-700 shrink-0">
                                      {item.quantity}
                                      {item.unit && ` ${item.unit}`}
                                    </span>
                                  )}
                                  <span
                                    className={`text-sm text-gray-800 ${
                                      item.checked ? "line-through" : ""
                                    }`}
                                  >
                                    {item.name}
                                  </span>
                                </div>
                                {item.recipeNames.length > 0 && (
                                  <p className="text-xs text-gray-400 truncate">
                                    {item.recipeNames.join(", ")}
                                  </p>
                                )}
                              </div>
                            )}

                            {editingId !== item.id && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => startEdit(item)}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </li>
                        ))}

                        {addingSection === section ? (
                              <li className="px-4 py-2 flex gap-2 items-center bg-brand-50">
                                <input
                                  autoFocus
                                  className="w-16 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={newItem.quantity}
                                  onChange={(event) =>
                                    setNewItem({
                                      ...newItem,
                                      quantity: event.target.value,
                                    })
                                  }
                                  placeholder="Qty"
                                />
                                <input
                                  className="w-20 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={newItem.unit}
                                  onChange={(event) =>
                                    setNewItem({
                                      ...newItem,
                                      unit: event.target.value,
                                    })
                                  }
                                  placeholder="Unit"
                                />
                                <input
                                  className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                  value={newItem.name}
                                  onChange={(event) =>
                                    setNewItem({
                                      ...newItem,
                                      name: event.target.value,
                                    })
                                  }
                                  placeholder="Item name"
                                  onKeyDown={(event) =>
                                    event.key === "Enter" && addItemToSection(section)
                                  }
                                />
                                <button
                                  onClick={() => addItemToSection(section)}
                                  className="text-brand-600 hover:text-brand-700"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  onClick={() => setAddingSection(null)}
                                  className="text-gray-400"
                                >
                                  <X size={16} />
                                </button>
                              </li>
                            ) : (
                              <li>
                                <button
                                  onClick={() => {
                                    setAddingSection(section);
                                    setNewItem({ name: "", quantity: "", unit: "" });
                                  }}
                                  className="w-full px-4 py-2 flex items-center gap-2 text-sm text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                >
                                  <Plus size={14} />
                                  Add item
                                </button>
                              </li>
                            )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
