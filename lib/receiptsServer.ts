import { createServiceSupabase } from "@/lib/supabase-server";
import { ReceiptItem, GrocerySection } from "@/lib/types";

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(num) ? num : undefined;
}

function mapRow(row: Record<string, unknown>): ReceiptItem {
  return {
    id: String(row.id),
    receiptId: String(row.receipt_id),
    rawLabel: typeof row.raw_label === "string" ? row.raw_label : "",
    normalizedName: typeof row.normalized_name === "string" ? row.normalized_name : "",
    brand: typeof row.brand === "string" && row.brand ? row.brand : undefined,
    section:
      typeof row.section === "string" && row.section ? (row.section as GrocerySection) : undefined,
    quantity: numberOrUndefined(row.quantity),
    unit: typeof row.unit === "string" && row.unit ? row.unit : undefined,
    packageSizeText:
      typeof row.package_size_text === "string" && row.package_size_text
        ? row.package_size_text
        : undefined,
    unitPrice: numberOrUndefined(row.unit_price),
    totalPrice: Number(row.total_price) || 0,
    currencyCode: typeof row.currency_code === "string" ? row.currency_code : "USD",
    purchasedAt: typeof row.purchased_at === "string" ? row.purchased_at : undefined,
    storeName: typeof row.store_name === "string" && row.store_name ? row.store_name : undefined,
    confidence: numberOrUndefined(row.confidence),
  };
}

/**
 * Load the caller's receipt-items price library. Scope: the caller's user_id
 * plus any household members they share a household with.
 *
 * Returns [] silently on any failure (missing tables before migration,
 * permission errors, etc.) so the pricing engine degrades gracefully.
 */
export async function loadReceiptLibraryForUser(userId: string): Promise<ReceiptItem[]> {
  if (!userId) return [];

  try {
    const supabase = createServiceSupabase();

    // Find user's household (if any) so we can include household-mate receipts.
    const { data: membership } = await supabase
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .maybeSingle();
    const householdId = membership?.household_id as string | undefined;

    // Collect all user ids whose receipts the caller should see.
    let userIds: string[] = [userId];
    if (householdId) {
      const { data: members } = await supabase
        .from("household_members")
        .select("user_id")
        .eq("household_id", householdId);
      if (members) {
        userIds = Array.from(
          new Set([userId, ...members.map((m: { user_id: string }) => m.user_id)])
        );
      }
    }

    let query = supabase
      .from("receipt_items")
      .select("*")
      .order("purchased_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(800);

    if (householdId) {
      query = query.or(
        `household_id.eq.${householdId},user_id.in.(${userIds.join(",")})`
      );
    } else {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      // 42P01 = undefined_table → migration hasn't been applied yet. Degrade silently.
      if ((error as { code?: string }).code === "42P01") return [];
      console.error("Receipt library lookup failed:", error);
      return [];
    }

    return (data ?? []).map(mapRow);
  } catch (error) {
    console.error("Receipt library lookup threw:", error);
    return [];
  }
}
