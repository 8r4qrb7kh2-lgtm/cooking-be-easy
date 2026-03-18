"use client";

import { Ingredient, GROCERY_SECTIONS, GrocerySection } from "@/lib/types";
import { Trash2, Plus } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

export interface IngredientEditorMeta {
  label: string;
  detail?: string;
  href?: string;
}

interface Props {
  ingredients: Ingredient[];
  onChange: (ingredients: Ingredient[]) => void;
  metaByIngredientId?: Record<string, IngredientEditorMeta>;
}

export default function IngredientEditor({
  ingredients,
  onChange,
  metaByIngredientId,
}: Props) {
  function update(id: string, field: keyof Ingredient, value: string) {
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, [field]: value } : ing
      )
    );
  }

  function remove(id: string) {
    onChange(ingredients.filter((ing) => ing.id !== id));
  }

  function add() {
    onChange([
      ...ingredients,
      {
        id: uuidv4(),
        name: "",
        quantity: "",
        unit: "",
        section: "Other" as GrocerySection,
      },
    ]);
  }

  return (
    <div className="space-y-2">
      {ingredients.map((ing, i) => (
        <div key={ing.id} className="flex gap-2 items-start bg-white rounded-lg border border-gray-200 p-2">
          <span className="text-xs text-gray-400 pt-2.5 w-5 text-right shrink-0">{i + 1}</span>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input
              className="col-span-2 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Ingredient name"
              value={ing.name}
              onChange={(e) => update(ing.id, "name", e.target.value)}
            />
            <input
              className="px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Qty"
              value={ing.quantity}
              onChange={(e) => update(ing.id, "quantity", e.target.value)}
            />
            <input
              className="px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Unit (cups, oz…)"
              value={ing.unit}
              onChange={(e) => update(ing.id, "unit", e.target.value)}
            />
            <select
              className="col-span-2 px-2 py-1.5 text-sm border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={ing.section}
              onChange={(e) =>
                update(ing.id, "section", e.target.value)
              }
            >
              {GROCERY_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {metaByIngredientId?.[ing.id] && (
              <div className="col-span-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                <p className="text-xs font-medium text-gray-800">
                  {metaByIngredientId[ing.id].label}
                </p>
                {metaByIngredientId[ing.id].detail && (
                  metaByIngredientId[ing.id].href ? (
                    <a
                      href={metaByIngredientId[ing.id].href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block text-[11px] leading-4 text-brand-700 hover:underline"
                    >
                      {metaByIngredientId[ing.id].detail}
                    </a>
                  ) : (
                    <p className="mt-1 text-[11px] leading-4 text-gray-500">
                      {metaByIngredientId[ing.id].detail}
                    </p>
                  )
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => remove(ing.id)}
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0 mt-0.5"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <button
        onClick={add}
        className="w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
      >
        <Plus size={16} />
        Add ingredient
      </button>
    </div>
  );
}
