"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Trash2,
  Plus,
  Save,
} from "lucide-react";
import ImageUpload from "@/components/ImageUpload";
import { saveReceipt } from "@/lib/receiptsStorage";
import { GROCERY_SECTIONS, GrocerySection } from "@/lib/types";

interface DraftItem {
  rawLabel: string;
  normalizedName: string;
  brand: string;
  section: GrocerySection | "";
  quantity: string;
  unit: string;
  packageSizeText: string;
  unitPrice: string;
  totalPrice: string;
  confidence: number;
}

interface DraftReceipt {
  storeName: string;
  storeLocation: string;
  purchaseDate: string;
  subtotal: string;
  total: string;
  items: DraftItem[];
}

function emptyDraft(): DraftReceipt {
  return {
    storeName: "",
    storeLocation: "",
    purchaseDate: "",
    subtotal: "",
    total: "",
    items: [],
  };
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

export default function NewReceiptPage() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [photo, setPhoto] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DraftReceipt>(emptyDraft());

  async function analyzeReceipt(base64: string) {
    setPhoto(base64);
    setAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/receipts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");

      const items: DraftItem[] = (Array.isArray(data.items) ? data.items : []).map(
        (item: Record<string, unknown>) => ({
          rawLabel: String(item.rawLabel ?? ""),
          normalizedName: String(item.normalizedName ?? ""),
          brand: typeof item.brand === "string" ? item.brand : "",
          section: (typeof item.section === "string" ? item.section : "") as DraftItem["section"],
          quantity:
            typeof item.quantity === "number"
              ? String(item.quantity)
              : typeof item.quantity === "string"
              ? item.quantity
              : "",
          unit: typeof item.unit === "string" ? item.unit : "",
          packageSizeText:
            typeof item.packageSizeText === "string" ? item.packageSizeText : "",
          unitPrice:
            typeof item.unitPrice === "number"
              ? String(item.unitPrice)
              : typeof item.unitPrice === "string"
              ? item.unitPrice
              : "",
          totalPrice:
            typeof item.totalPrice === "number"
              ? String(item.totalPrice)
              : typeof item.totalPrice === "string"
              ? item.totalPrice
              : "",
          confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
        })
      );

      setDraft({
        storeName: typeof data.storeName === "string" ? data.storeName : "",
        storeLocation: typeof data.storeLocation === "string" ? data.storeLocation : "",
        purchaseDate: typeof data.purchaseDate === "string" ? data.purchaseDate : "",
        subtotal: typeof data.subtotal === "number" ? String(data.subtotal) : "",
        total: typeof data.total === "number" ? String(data.total) : "",
        items,
      });
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze receipt");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateItem(index: number, updates: Partial<DraftItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    }));
  }

  function removeItem(index: number) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  }

  function addBlankItem() {
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          rawLabel: "",
          normalizedName: "",
          brand: "",
          section: "",
          quantity: "",
          unit: "",
          packageSizeText: "",
          unitPrice: "",
          totalPrice: "",
          confidence: 0.5,
        },
      ],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const items = draft.items
        .filter((item) => item.normalizedName.trim() && item.totalPrice.trim())
        .map((item) => ({
          rawLabel: item.rawLabel.trim() || item.normalizedName.trim(),
          normalizedName: item.normalizedName.trim().toLowerCase(),
          brand: item.brand.trim() || undefined,
          section: (item.section || undefined) as GrocerySection | undefined,
          quantity: parseNumber(item.quantity),
          unit: item.unit.trim() || undefined,
          packageSizeText: item.packageSizeText.trim() || undefined,
          unitPrice: parseNumber(item.unitPrice),
          totalPrice: parseNumber(item.totalPrice) ?? 0,
          currencyCode: "USD",
          confidence: item.confidence,
        }));

      if (items.length === 0) {
        setError("Add at least one item with a name and price before saving.");
        return;
      }

      const saved = await saveReceipt({
        storeName: draft.storeName.trim() || undefined,
        storeLocation: draft.storeLocation.trim() || undefined,
        purchaseDate: draft.purchaseDate.trim() || undefined,
        subtotal: parseNumber(draft.subtotal),
        total: parseNumber(draft.total),
        currencyCode: "USD",
        imageBase64: photo ?? undefined,
        items,
      });

      router.push(`/receipts/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save receipt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/receipts" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Upload Receipt</h1>
      </div>

      {step === "upload" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Snap a clear photo of your grocery receipt. Claude AI will read every line item, decode
            cryptic store abbreviations (like &ldquo;365WFM BBY BELLA MUSHROOM&rdquo; → baby bella
            mushrooms), and add everything to your personal price library so recipes can use your
            actual prices.
          </p>

          {analyzing ? (
            <div className="flex items-center justify-center gap-2 py-14 text-brand-700 font-medium">
              <Loader2 size={24} className="animate-spin" />
              <Sparkles size={16} />
              Reading receipt with Claude AI…
            </div>
          ) : (
            <ImageUpload
              label="Photo of receipt"
              onImage={analyzeReceipt}
              className="h-56"
            />
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      {step === "review" && (
        <div className="space-y-5">
          {photo && (
            <div className="flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt="Receipt"
                className="w-24 h-32 object-cover rounded-xl border border-gray-200"
              />
              <p className="text-sm text-gray-500 flex-1">
                Review the extracted items below. Fix anything that looks off — Claude does a great
                job but abbreviations can be tricky. Click save when everything looks right.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1">Store</span>
              <input
                value={draft.storeName}
                onChange={(e) => setDraft((d) => ({ ...d, storeName: e.target.value }))}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="Whole Foods Market"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1">Date</span>
              <input
                type="date"
                value={draft.purchaseDate}
                onChange={(e) => setDraft((d) => ({ ...d, purchaseDate: e.target.value }))}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <label className="block col-span-2">
              <span className="block text-xs font-medium text-gray-500 mb-1">Location</span>
              <input
                value={draft.storeLocation}
                onChange={(e) => setDraft((d) => ({ ...d, storeLocation: e.target.value }))}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="Cedar Center, University Heights, OH"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1">Subtotal</span>
              <input
                type="number"
                step="0.01"
                value={draft.subtotal}
                onChange={(e) => setDraft((d) => ({ ...d, subtotal: e.target.value }))}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-500 mb-1">Total</span>
              <input
                type="number"
                step="0.01"
                value={draft.total}
                onChange={(e) => setDraft((d) => ({ ...d, total: e.target.value }))}
                className="w-full h-9 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-gray-900 text-sm">
                Items ({draft.items.length})
              </h2>
              <button
                type="button"
                onClick={addBlankItem}
                className="flex items-center gap-1 text-sm text-brand-700 hover:text-brand-800"
              >
                <Plus size={14} />
                Add item
              </button>
            </div>

            <div className="space-y-3">
              {draft.items.map((item, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-gray-200 bg-white p-3 space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 space-y-2">
                      <input
                        value={item.normalizedName}
                        onChange={(e) =>
                          updateItem(index, { normalizedName: e.target.value })
                        }
                        placeholder="baby bella mushrooms"
                        className="w-full h-8 px-2 text-sm font-semibold border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                      <input
                        value={item.rawLabel}
                        onChange={(e) => updateItem(index, { rawLabel: e.target.value })}
                        placeholder="365WFM BBY BELLA MUSHROOM"
                        className="w-full h-7 px-2 text-xs text-gray-500 border border-gray-100 rounded focus:outline-none focus:ring-1 focus:ring-brand-500 font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Qty
                      </span>
                      <input
                        value={item.quantity}
                        onChange={(e) => updateItem(index, { quantity: e.target.value })}
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="1"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Unit
                      </span>
                      <input
                        value={item.unit}
                        onChange={(e) => updateItem(index, { unit: e.target.value })}
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="lb"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Unit $
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Total $
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={item.totalPrice}
                        onChange={(e) => updateItem(index, { totalPrice: e.target.value })}
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                        placeholder="0.00"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Package
                      </span>
                      <input
                        value={item.packageSizeText}
                        onChange={(e) =>
                          updateItem(index, { packageSizeText: e.target.value })
                        }
                        placeholder="16 oz bag"
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">
                        Section
                      </span>
                      <select
                        value={item.section}
                        onChange={(e) =>
                          updateItem(index, { section: e.target.value as DraftItem["section"] })
                        }
                        className="w-full h-8 px-2 text-sm border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="">—</option>
                        {GROCERY_SECTIONS.map((section) => (
                          <option key={section} value={section}>
                            {section}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {draft.items.length === 0 && (
              <p className="text-sm text-gray-500 py-6 text-center border border-dashed rounded-lg">
                No items extracted yet. Add one manually if needed.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || draft.items.length === 0}
            className="w-full py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? "Saving…" : "Save Receipt"}
          </button>
        </div>
      )}
    </div>
  );
}
