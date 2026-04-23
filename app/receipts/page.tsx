"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Receipt as ReceiptIcon,
  Store,
  Calendar,
  Trash2,
  Search,
} from "lucide-react";
import { Receipt } from "@/lib/types";
import { getReceipts, deleteReceipt } from "@/lib/receiptsStorage";
import PageLoadingScreen from "@/components/PageLoadingScreen";

function formatCurrency(value: number | undefined, code = "USD"): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
}

function formatDate(value: string | undefined): string {
  if (!value) return "";
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

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const items = await getReceipts();
        if (!mounted) return;
        setReceipts(items);
      } catch (error) {
        if (!mounted) return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load receipts. If this is your first time, apply the receipts migration."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this receipt? Its items will no longer influence recipe pricing.")) {
      return;
    }
    await deleteReceipt(id);
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }

  const visibleReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) => {
      const haystack = [
        r.storeName,
        r.storeLocation,
        r.purchaseDate,
        ...r.items.map((i) => `${i.rawLabel} ${i.normalizedName} ${i.brand ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [receipts, searchQuery]);

  const totalTracked = useMemo(() => {
    return receipts.reduce((sum, r) => sum + (r.total ?? 0), 0);
  }, [receipts]);

  const uniqueItemCount = useMemo(() => {
    const seen = new Set<string>();
    for (const r of receipts) {
      for (const item of r.items) {
        seen.add(item.normalizedName.toLowerCase());
      }
    }
    return seen.size;
  }, [receipts]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receipts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loading
              ? "Loading your price library..."
              : receipts.length === 0
              ? "Upload a grocery receipt to start building your price library"
              : `${receipts.length} receipt${receipts.length === 1 ? "" : "s"} · ${uniqueItemCount} unique item${
                  uniqueItemCount === 1 ? "" : "s"
                } in your price library${
                  totalTracked > 0 ? ` · ${formatCurrency(totalTracked)} tracked` : ""
                }`}
          </p>
        </div>
        <Link
          href="/receipts/new"
          className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus size={18} />
          Upload
        </Link>
      </div>

      {errorMessage && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {errorMessage}
        </div>
      )}

      {receipts.length > 0 && (
        <label className="relative mb-5 block">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items, store, or date"
            className="w-full h-10 pl-9 pr-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          />
        </label>
      )}

      {loading ? (
        <PageLoadingScreen />
      ) : receipts.length === 0 ? (
        <div className="text-center py-20">
          <ReceiptIcon size={48} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-lg font-semibold text-gray-500">No receipts yet</h2>
          <p className="text-sm text-gray-400 mt-1 mb-6 max-w-sm mx-auto">
            Snap a photo of your next grocery receipt. Claude AI will extract every item and price,
            and recipes will use the actual prices you paid.
          </p>
          <Link
            href="/receipts/new"
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-lg font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus size={18} />
            Upload Receipt
          </Link>
        </div>
      ) : visibleReceipts.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-500">No matches found</h2>
          <p className="text-sm text-gray-400 mt-1">Try a different search term.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleReceipts.map((receipt) => (
            <div key={receipt.id} className="relative group">
              <Link
                href={`/receipts/${receipt.id}`}
                className="block bg-white border border-gray-200 rounded-xl hover:shadow-md transition-shadow"
              >
                <div className="flex items-stretch">
                  {receipt.imageBase64 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={receipt.imageBase64}
                      alt="Receipt"
                      className="w-20 h-24 object-cover rounded-l-xl shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-24 bg-gray-50 rounded-l-xl flex items-center justify-center shrink-0">
                      <ReceiptIcon size={28} className="text-gray-300" />
                    </div>
                  )}
                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                        <Store size={14} className="text-gray-400 shrink-0" />
                        {receipt.storeName || "Unknown store"}
                      </h3>
                      <span className="text-sm font-semibold text-gray-900 shrink-0">
                        {formatCurrency(receipt.total, receipt.currencyCode)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                      <Calendar size={12} />
                      {formatDate(receipt.purchaseDate) || "Date unknown"}
                      {" · "}
                      {receipt.items.length} item{receipt.items.length === 1 ? "" : "s"}
                    </p>
                    {receipt.storeLocation && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {receipt.storeLocation}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete(receipt.id);
                }}
                className="absolute top-2 right-2 p-1.5 bg-white rounded-full shadow text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
