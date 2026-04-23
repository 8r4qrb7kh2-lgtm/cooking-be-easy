import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "./supabase";
import { Receipt, ReceiptItem, GrocerySection } from "./types";

async function getUserId(): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");
  return session.user.id;
}

async function getHouseholdId(): Promise<string | null> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const { data } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .single();
  return data?.household_id ?? null;
}

function numberOrNull(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(num) ? num : undefined;
}

function sanitizeSection(value: unknown): GrocerySection | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? (trimmed as GrocerySection) : undefined;
}

function mapItemRow(row: Record<string, unknown>): ReceiptItem {
  return {
    id: String(row.id),
    receiptId: String(row.receipt_id),
    rawLabel: typeof row.raw_label === "string" ? row.raw_label : "",
    normalizedName: typeof row.normalized_name === "string" ? row.normalized_name : "",
    brand: typeof row.brand === "string" && row.brand ? row.brand : undefined,
    section: sanitizeSection(row.section),
    quantity: numberOrNull(row.quantity),
    unit: typeof row.unit === "string" && row.unit ? row.unit : undefined,
    packageSizeText:
      typeof row.package_size_text === "string" && row.package_size_text
        ? row.package_size_text
        : undefined,
    unitPrice: numberOrNull(row.unit_price),
    totalPrice: Number(row.total_price) || 0,
    currencyCode: typeof row.currency_code === "string" ? row.currency_code : "USD",
    purchasedAt: typeof row.purchased_at === "string" ? row.purchased_at : undefined,
    storeName: typeof row.store_name === "string" && row.store_name ? row.store_name : undefined,
    confidence: numberOrNull(row.confidence),
  };
}

function mapReceiptRow(
  row: Record<string, unknown>,
  items: ReceiptItem[] = []
): Receipt {
  return {
    id: String(row.id),
    storeName: typeof row.store_name === "string" && row.store_name ? row.store_name : undefined,
    storeLocation:
      typeof row.store_location === "string" && row.store_location
        ? row.store_location
        : undefined,
    purchaseDate: typeof row.purchase_date === "string" ? row.purchase_date : undefined,
    subtotal: numberOrNull(row.subtotal),
    total: numberOrNull(row.total),
    currencyCode: typeof row.currency_code === "string" ? row.currency_code : "USD",
    imageBase64:
      typeof row.image_base64 === "string" && row.image_base64 ? row.image_base64 : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
  };
}

export async function getReceipts(): Promise<Receipt[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .order("purchase_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return []; // table doesn't exist yet
    throw error;
  }

  if (!data || data.length === 0) return [];

  const receiptIds = data.map((row) => String(row.id));
  const { data: itemRows, error: itemError } = await supabase
    .from("receipt_items")
    .select("*")
    .in("receipt_id", receiptIds);
  if (itemError && itemError.code !== "42P01") throw itemError;

  const itemsByReceiptId = new Map<string, ReceiptItem[]>();
  for (const row of itemRows ?? []) {
    const item = mapItemRow(row);
    const list = itemsByReceiptId.get(item.receiptId) ?? [];
    list.push(item);
    itemsByReceiptId.set(item.receiptId, list);
  }

  return data.map((row) => mapReceiptRow(row, itemsByReceiptId.get(String(row.id)) ?? []));
}

export async function getReceipt(id: string): Promise<Receipt | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST116") return null;
    throw error;
  }
  if (!data) return null;

  const { data: itemRows, error: itemError } = await supabase
    .from("receipt_items")
    .select("*")
    .eq("receipt_id", id)
    .order("created_at", { ascending: true });
  if (itemError && itemError.code !== "42P01") throw itemError;

  return mapReceiptRow(data, (itemRows ?? []).map(mapItemRow));
}

export interface SaveReceiptInput {
  storeName?: string;
  storeLocation?: string;
  purchaseDate?: string;
  subtotal?: number;
  total?: number;
  currencyCode?: string;
  imageBase64?: string;
  items: Array<Omit<ReceiptItem, "id" | "receiptId">>;
}

export async function saveReceipt(input: SaveReceiptInput): Promise<Receipt> {
  const supabase = getSupabase();
  const userId = await getUserId();
  const householdId = await getHouseholdId();

  const receiptId = uuidv4();
  const now = new Date().toISOString();
  const currencyCode = input.currencyCode ?? "USD";

  const { error: receiptError } = await supabase.from("receipts").insert({
    id: receiptId,
    user_id: userId,
    household_id: householdId,
    store_name: input.storeName ?? null,
    store_location: input.storeLocation ?? null,
    purchase_date: input.purchaseDate ?? null,
    subtotal: input.subtotal ?? null,
    total: input.total ?? null,
    currency_code: currencyCode,
    image_base64: input.imageBase64 ?? null,
    created_at: now,
    updated_at: now,
  });
  if (receiptError) throw receiptError;

  if (input.items.length > 0) {
    const itemRows = input.items.map((item) => ({
      id: uuidv4(),
      receipt_id: receiptId,
      user_id: userId,
      household_id: householdId,
      raw_label: item.rawLabel,
      normalized_name: item.normalizedName,
      brand: item.brand ?? null,
      section: item.section ?? null,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
      package_size_text: item.packageSizeText ?? null,
      unit_price: item.unitPrice ?? null,
      total_price: item.totalPrice,
      currency_code: item.currencyCode || currencyCode,
      purchased_at: item.purchasedAt ?? input.purchaseDate ?? null,
      store_name: item.storeName ?? input.storeName ?? null,
      confidence: item.confidence ?? null,
    }));

    const { error: itemsError } = await supabase.from("receipt_items").insert(itemRows);
    if (itemsError) throw itemsError;
  }

  const saved = await getReceipt(receiptId);
  if (!saved) throw new Error("Failed to load receipt after save");
  return saved;
}

export async function deleteReceipt(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("receipts").delete().eq("id", id);
  if (error && error.code !== "42P01") throw error;
}

export async function updateReceiptItem(
  id: string,
  updates: Partial<Omit<ReceiptItem, "id" | "receiptId">>
): Promise<void> {
  const supabase = getSupabase();
  const row: Record<string, unknown> = {};
  if (updates.rawLabel !== undefined) row.raw_label = updates.rawLabel;
  if (updates.normalizedName !== undefined) row.normalized_name = updates.normalizedName;
  if (updates.brand !== undefined) row.brand = updates.brand || null;
  if (updates.section !== undefined) row.section = updates.section || null;
  if (updates.quantity !== undefined) row.quantity = updates.quantity ?? null;
  if (updates.unit !== undefined) row.unit = updates.unit || null;
  if (updates.packageSizeText !== undefined)
    row.package_size_text = updates.packageSizeText || null;
  if (updates.unitPrice !== undefined) row.unit_price = updates.unitPrice ?? null;
  if (updates.totalPrice !== undefined) row.total_price = updates.totalPrice;

  if (Object.keys(row).length === 0) return;

  const { error } = await supabase.from("receipt_items").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteReceiptItem(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("receipt_items").delete().eq("id", id);
  if (error) throw error;
}
