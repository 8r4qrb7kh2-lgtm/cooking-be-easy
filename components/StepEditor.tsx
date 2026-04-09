"use client";

import { ListOrdered, Plus, Trash2 } from "lucide-react";

interface Props {
  steps: string[];
  onChange: (steps: string[]) => void;
  emptyLabel?: string;
  placeholder?: string;
}

export default function StepEditor({
  steps,
  onChange,
  emptyLabel = "No steps yet. Add the first one below.",
  placeholder = "Describe this step",
}: Props) {
  function update(index: number, value: string) {
    onChange(steps.map((step, stepIndex) => (stepIndex === index ? value : step)));
  }

  function remove(index: number) {
    onChange(steps.filter((_, stepIndex) => stepIndex !== index));
  }

  function add() {
    onChange([...steps, ""]);
  }

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500">
          {emptyLabel}
        </div>
      )}

      {steps.map((step, index) => (
        <div key={index} className="flex gap-2 items-start rounded-lg border border-gray-200 bg-white p-2">
          <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
            {index + 1}
          </span>
          <textarea
            className="min-h-[4.5rem] flex-1 resize-y rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            rows={3}
            value={step}
            placeholder={placeholder}
            onChange={(event) => update(index, event.target.value)}
          />
          <button
            type="button"
            onClick={() => remove(index)}
            className="mt-0.5 shrink-0 rounded p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
            aria-label={`Remove step ${index + 1}`}
            title={`Remove step ${index + 1}`}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:border-brand-400 hover:text-brand-600"
      >
        <Plus size={16} />
        <ListOrdered size={16} />
        Add step
      </button>
    </div>
  );
}
