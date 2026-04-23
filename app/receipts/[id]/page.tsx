"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Trash2,
  Calendar,
  Store,
  MapPin,
  Loader2,
} from "lucide-react";
import { Receipt } from "@/lib/types";
import {
  getReceipt,
  deleteReceipt,
  deleteReceiptItem,
  updateReceiptItem,
} from "@/lib/receiptsStorage";

function formatCurrency(value: number | undefined, code = "USD"): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
}

function formatDate(value: string | undefined): string {
  if (!value) return "Date unknown";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const r = await getReceipt(id);
        if (!mounted) return;
        if (!r) {
          router.replace("/receipts");
          return;
        }
        setReceipt(r);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [id, router]);

  async function handleDelete() {
    if (!receipt) return;
    if (!confirm("Delete this receipt and all its items from your price library?")) return;
    await deleteReceipt(receipt.id);
    router.push("/receipts");
  }

  async function handleRemoveItem(itemId: string) {
    if (!receipt) return;
    await deleteReceiptItem(itemId);
    setReceipt({ ...receipt, items: receipt.items.filter((i) => i.id !== itemId) });
  }

  async function handleUpdateItem(
    itemId: string,
    updates: Partial<{ normalizedName: string; totalPrice: number }>
  ) {
    if (!receipt) return;
    setSavingItemId(itemId);
    try {
      await updateReceiptItem(itemId, updates);
      setReceipt({
        ...receipt,
        items: receipt.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
      });
    } finally {
      setSavingItemId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (!receipt) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/receipts" className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold text-gray-900 truncate">
            {receipt.storeName || "Receipt"}
          </h1>
        </div>
        <button
          onClick={handleDelete}
          className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50"
          title="Delete receipt"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center">
        {receipt.imageBase64 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={receipt.imageBase64}
            alt="Receipt"
            className="w-24 h-32 object-cover rounded-lg border border-gray-100 sm:mr-2"
          />
        )}
        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 text-gray-700">
            <Calendar size={14} className="text-gray-400" />
            {formatDate(receipt.purchaseDate)}
          </p>
          {receipt.storeName && (
            <p className="flex items-center gap-2 text-gray-700">
              <Store size={14} className="text-gray-400" />
              {receipt.storeName}
            </p>
          )}
          {receipt.storeLocation && (
            <p className="flex items-center gap-2 text-gray-500">
              <MapPin size={14} className="text-gray-400" />
              {receipt.storeLocation}
            </p>
          )}
          <div className="flex items-center gap-4 pt-1">
            <span className="text-gray-500 text-xs">
              {receipt.items.length} item{receipt.items.length === 1 ? "" : "s"}
            </span>
            {receipt.subtotal !== undefined && (
              <span className="text-gray-500 text-xs">
                Subtotal {formatCurrency(receipt.subtotal, receipt.currencyCode)}
              </span>
            )}
            {receipt.total !== undefined && (
              <span className="font-semibold text-gray-900">
                Total {formatCurrency(receipt.total, receipt.currencyCode)}
              </span>
            )}
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">Items in your price library</h2>
      <div className="space-y-2">
        {receipt.items.map((item) => (
          <div
            key={item.id}
            className="bg-white border border-gray-200 rounded-xl p-3 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <input
                value={item.normalizedName}
                onChange={(e) => {
                  const newName = e.target.value;
                  setReceipt((prev) =>
                    prev
                      ? {
                          ...prev,
                          items: prev.items.map((i) =>
                            i.id === item.id ? { ...i, normalizedName: newName } : i
                          ),
                        }
                      : prev
                  );
                }}
                onBlur={(e) =>
                  handleUpdateItem(item.id, { normalizedName: e.target.value.trim().toLowerCase() })
                }
                className="w-full font-medium text-sm text-gray-900 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-brand-500 rounded px-1 -ml-1"
              />
              <p className="text-xs text-gray-400 mt-0.5 font-mono">{item.rawLabel}</p>
              <p className="text-xs text-gray-500 mt-1">
                {[
                  item.quantity !== undefined && item.unit
                    ? `${item.quantity} ${item.unit}`
                    : item.quantity !== undefined
                    ? `${item.quantity}`
                    : null,
                  item.packageSizeText,
                  item.brand,
                  item.section,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={item.totalPrice}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && value !== item.totalPrice) {
                      handleUpdateItem(item.id, { totalPrice: value });
                    }
                  }}
                  className="w-20 h-8 px-2 text-sm text-right font-semibold border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                {savingItemId === item.id && (
                  <Loader2 size={12} className="animate-spin text-gray-400" />
                )}
              </div>
              <button
                onClick={() => handleRemoveItem(item.id)}
                className="text-gray-300 hover:text-red-500 p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {receipt.items.length === 0 && (
          <p className="text-sm text-gray-500 py-6 text-center border border-dashed rounded-lg">
            No items on this receipt.
          </p>
        )}
      </div>
    </div>
  );
}
