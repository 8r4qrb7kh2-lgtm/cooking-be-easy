"use client";

import { useEffect, useMemo, useState } from "react";
import { Ingredient } from "@/lib/types";
import {
  buildRecipeTable,
  formatRecipeTableIngredient,
} from "@/lib/recipeTable";

const LABEL_CACHE_KEY_PREFIX = "cooking-be-easy-recipe-table-labels";

interface RecipeTableViewProps {
  recipeId: string;
  recipeUpdatedAt: string;
  /** Distinguishes cached labels for source steps from cooking steps. */
  stepSourceKey: string;
  ingredients: Ingredient[];
  steps: string[];
  firstStepById: Map<string, number>;
  quantityScale: number;
  currentStep: number;
  onSelectStep: (stepIndex: number) => void;
}

export default function RecipeTableView({
  recipeId,
  recipeUpdatedAt,
  stepSourceKey,
  ingredients,
  steps,
  firstStepById,
  quantityScale,
  currentStep,
  onSelectStep,
}: RecipeTableViewProps) {
  const [labelByStep, setLabelByStep] = useState<Record<number, string> | null>(
    null
  );
  const [labelsLoading, setLabelsLoading] = useState(false);

  useEffect(() => {
    if (steps.length === 0) {
      setLabelByStep({});
      return;
    }

    const cacheKey = `${LABEL_CACHE_KEY_PREFIX}:${recipeId}:${stepSourceKey}:${recipeUpdatedAt}`;
    setLabelByStep(null);

    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Record<string, unknown>;
          const validCached: Record<number, string> = {};

          for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const value = parsed[String(stepIndex)];
            if (typeof value === "string" && value.trim()) {
              validCached[stepIndex] = value;
            }
          }

          setLabelByStep(validCached);
          return;
        } catch {
          // ignore invalid cache and fetch fresh labels
        }
      }
    }

    let cancelled = false;
    setLabelsLoading(true);

    async function loadLabels() {
      try {
        const res = await fetch("/api/recipe-table", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            steps,
            ingredients: ingredients.map((ingredient) => ({
              name: ingredient.name,
            })),
          }),
        });
        if (!res.ok) throw new Error("Failed to build recipe table labels");

        const data = await res.json();
        const source =
          data && typeof data === "object" && data.labelByStep
            ? (data.labelByStep as Record<string, unknown>)
            : {};

        const validLabels: Record<number, string> = {};
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
          const value = source[String(stepIndex)];
          if (typeof value === "string" && value.trim()) {
            validLabels[stepIndex] = value;
          }
        }

        if (cancelled) return;

        setLabelByStep(validLabels);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(cacheKey, JSON.stringify(validLabels));
        }
      } catch {
        // Fall back to the locally condensed labels.
        if (!cancelled) setLabelByStep({});
      } finally {
        if (!cancelled) setLabelsLoading(false);
      }
    }

    loadLabels();

    return () => {
      cancelled = true;
    };
  }, [ingredients, recipeId, recipeUpdatedAt, stepSourceKey, steps]);

  const table = useMemo(
    () => buildRecipeTable(ingredients, steps, firstStepById, labelByStep),
    [firstStepById, ingredients, labelByStep, steps]
  );

  const columnCount = 1 + table.columns.length;
  const columnsByStartRow = useMemo(() => {
    const grouped = new Map<number, typeof table.columns>();
    for (const column of table.columns) {
      const existing = grouped.get(column.startRow);
      if (existing) existing.push(column);
      else grouped.set(column.startRow, [column]);
    }
    return grouped;
  }, [table.columns]);

  if (table.prepRows.length === 0 && table.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        This recipe doesn&apos;t have enough detail to lay out as a table yet.
      </div>
    );
  }

  const cellBorder = "border border-brand-700";

  return (
    <div>
      <div className="rounded-2xl bg-[#fdfbe7] p-3 shadow-sm sm:p-4">
        <div className="overflow-x-auto">
          <table
            className={`w-full min-w-full border-collapse bg-white text-sm leading-snug text-gray-900 sm:text-[15px] ${cellBorder}`}
          >
            <tbody>
              {table.prepRows.map((prepRow) => (
                <tr key={`prep-${prepRow.stepIndex}`}>
                  <td
                    colSpan={columnCount}
                    className={`${cellBorder} p-0 ${
                      prepRow.stepIndex === currentStep ? "bg-brand-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectStep(prepRow.stepIndex)}
                      title={prepRow.text}
                      className="block w-full px-3 py-2 text-center transition-colors hover:bg-brand-50"
                    >
                      {prepRow.text}
                    </button>
                  </td>
                </tr>
              ))}

              {table.rows.map((row, rowIndex) => (
                <tr key={row.ingredient.id}>
                  <td
                    className={`${cellBorder} px-3 py-2 align-middle ${
                      row.stepIndex === currentStep ? "bg-brand-50" : ""
                    }`}
                    style={{ minWidth: "10.5rem" }}
                  >
                    {formatRecipeTableIngredient(row.ingredient, quantityScale)}
                  </td>

                  {(columnsByStartRow.get(rowIndex) ?? []).map((column) => (
                    <td
                      key={`op-${column.stepIndex}`}
                      rowSpan={column.endRow - column.startRow + 1}
                      className={`${cellBorder} p-0 align-middle ${
                        column.stepIndex === currentStep ? "bg-brand-50" : ""
                      }`}
                      style={{ minWidth: "4.5rem" }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectStep(column.stepIndex)}
                        title={column.text}
                        className="block h-full w-full px-3 py-2 text-center transition-colors hover:bg-brand-50"
                      >
                        {column.label}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-gray-400">
        {labelsLoading ? (
          "Shortening the operation labels..."
        ) : (
          <>
            <span className="sm:hidden">Swipe across to see every operation. </span>
            <span className="hidden sm:inline">
              Ingredients flow left to right into each operation.{" "}
            </span>
            Tap a cell to jump to that step.
          </>
        )}
      </p>
    </div>
  );
}
