"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Recipe,
  ShoppingListItem,
  GrocerySection,
  GROCERY_SECTIONS,
} from "@/lib/types";
import { getRecipes, getShoppingList, saveShoppingList } from "@/lib/storage";
import { getRecentRecipeViews, RecentRecipeViews } from "@/lib/recentViews";
import { RecipeSortOption } from "@/lib/recipeSort";
import { groupBySection } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";
import {
  ShoppingCart,
  CheckSquare2,
  Square,
  Trash2,
  Plus,
  Edit2,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";

export default function ShoppingPage() {
  const [items, setItems] = useState<ShoppingListItem[]>([]);
  const [checklistMode, setChecklistMode] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState({ quantity: "", unit: "", name: "" });
  const [addingSection, setAddingSection] = useState<GrocerySection | null>(null);
  const [newItem, setNewItem] = useState({ name: "", quantity: "", unit: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<RecipeSortOption>("recently-viewed");
  const [recentViewsByRecipeId, setRecentViewsByRecipeId] =
    useState<RecentRecipeViews>({});
  const [recipesById, setRecipesById] = useState<Record<string, Recipe>>({});

  useEffect(() => {
    async function load() {
      const [shoppingItems, recipes] = await Promise.all([
        getShoppingList(),
        getRecipes(),
      ]);
      setItems(shoppingItems);
      setRecipesById(
        Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe]))
      );
      setRecentViewsByRecipeId(getRecentRecipeViews());
    }

    load();
  }, []);

  async function persist(next: ShoppingListItem[]) {
    setItems(next);
    await saveShoppingList(next);
  }

  function toggleCheck(id: string) {
    persist(items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)));
  }

  function removeItem(id: string) {
    persist(items.filter((item) => item.id !== id));
  }

  function startEdit(item: ShoppingListItem) {
    setEditingId(item.id);
    setEditBuf({ quantity: item.quantity, unit: item.unit, name: item.name });
  }

  function saveEdit(id: string) {
    persist(
      items.map((item) =>
        item.id === id
          ? { ...item, quantity: editBuf.quantity, unit: editBuf.unit, name: editBuf.name }
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
    persist([...items, item]);
    setNewItem({ name: "", quantity: "", unit: "" });
    setAddingSection(null);
  }

  function toggleSection(section: string) {
    const next = new Set(collapsedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setCollapsedSections(next);
  }

  function clearChecked() {
    persist(items.filter((item) => !item.checked));
  }

  function clearAll() {
    if (!confirm("Clear all shopping items?")) return;
    persist([]);
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

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
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
  }, [items, recentViewsByRecipeId, recipesById, searchQuery, sortOption]);

  const grouped = groupBySection(visibleItems);
  const checkedCount = items.filter((i) => i.checked).length;
  const totalCount = items.length;
  const visibleCount = visibleItems.length;
  const activeSections = GROCERY_SECTIONS.filter((s) => grouped[s].length > 0);

  if (items.length === 0) {
    return (
      <div className="text-center py-20">
        <ShoppingCart size={48} className="mx-auto text-gray-300 mb-4" />
        <h2 className="text-lg font-semibold text-gray-500">No shopping list yet</h2>
        <p className="text-sm text-gray-400 mt-1 mb-6">
          Select recipes in the Planner to generate your list
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shopping List</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {checkedCount}/{totalCount} items checked
            {` · showing ${visibleCount}`}
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
          {checkedCount > 0 && (
            <button
              onClick={clearChecked}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Trash2 size={13} />
              Clear {checkedCount}
            </button>
          )}
          <button
            onClick={() => setChecklistMode(!checklistMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              checklistMode
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {checklistMode ? (
              <>
                <CheckSquare2 size={16} />
                Check mode
              </>
            ) : (
              <>
                <Square size={16} />
                Check mode
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shopping items"
            className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          />
        </label>
        <select
          value={sortOption}
          onChange={(e) => setSortOption(e.target.value as RecipeSortOption)}
          className="h-10 text-sm px-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="Sort shopping items"
        >
          <option value="recently-viewed">Recently viewed</option>
          <option value="rating-desc">Rating: high to low</option>
        </select>
      </div>

      {/* Progress bar */}
      {checklistMode && totalCount > 0 && (
        <div className="mb-5 bg-gray-100 rounded-full h-2 overflow-hidden">
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
        <>
          {/* Sections */}
          <div className="space-y-4">
            {activeSections.map((section) => {
              const sectionItems = grouped[section];
              const collapsed = collapsedSections.has(section);
              const sectionChecked = sectionItems.filter((i) => i.checked).length;

              return (
                <div key={section} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Section header */}
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
                    {checklistMode && sectionChecked > 0 && (
                      <span className="text-xs text-brand-600 font-medium">
                        {sectionChecked}/{sectionItems.length}
                      </span>
                    )}
                  </button>

                  {/* Items */}
                  {!collapsed && (
                    <ul className="divide-y divide-gray-50">
                      {sectionItems.map((item) => (
                        <li
                          key={item.id}
                          className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                            item.checked ? "bg-gray-50" : ""
                          }`}
                        >
                      {/* Checkbox in checklist mode */}
                      {checklistMode && (
                        <button
                          onClick={() => toggleCheck(item.id)}
                          className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            item.checked
                              ? "bg-brand-500 border-brand-500"
                              : "border-gray-300 hover:border-brand-400"
                          }`}
                        >
                          {item.checked && <Check size={13} className="text-white" />}
                        </button>
                      )}

                      {/* Item content */}
                      {editingId === item.id ? (
                        <div className="flex-1 flex gap-2 items-center">
                          <input
                            className="w-16 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                            value={editBuf.quantity}
                            onChange={(e) => setEditBuf({ ...editBuf, quantity: e.target.value })}
                            placeholder="Qty"
                          />
                          <input
                            className="w-20 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                            value={editBuf.unit}
                            onChange={(e) => setEditBuf({ ...editBuf, unit: e.target.value })}
                            placeholder="Unit"
                          />
                          <input
                            className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                            value={editBuf.name}
                            onChange={(e) => setEditBuf({ ...editBuf, name: e.target.value })}
                            placeholder="Name"
                          />
                          <button onClick={() => saveEdit(item.id)} className="text-brand-600 hover:text-brand-700">
                            <Check size={16} />
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600">
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

                      {/* Actions (non-checklist mode) */}
                      {!checklistMode && editingId !== item.id && (
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

                      {/* Checklist mode: remove button */}
                      {checklistMode && (
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1.5 text-gray-300 hover:text-red-400 transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      )}
                        </li>
                      ))}

                      {/* Add item row */}
                      {!checklistMode && (
                        <>
                          {addingSection === section ? (
                            <li className="px-4 py-2 flex gap-2 items-center bg-brand-50">
                              <input
                                autoFocus
                                className="w-16 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                value={newItem.quantity}
                                onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
                                placeholder="Qty"
                              />
                              <input
                                className="w-20 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                value={newItem.unit}
                                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                                placeholder="Unit"
                              />
                              <input
                                className="flex-1 text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 bg-white"
                                value={newItem.name}
                                onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                                placeholder="Item name"
                                onKeyDown={(e) => e.key === "Enter" && addItemToSection(section)}
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
                        </>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
