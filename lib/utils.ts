import {
  ShoppingListItem,
  GrocerySection,
  GROCERY_SECTIONS,
} from "./types";

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImage(
  file: File,
  maxWidthOrHeight = 1200,
  quality = 0.8
): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > maxWidthOrHeight || height > maxWidthOrHeight) {
      if (width > height) {
        height = Math.round((height * maxWidthOrHeight) / width);
        width = maxWidthOrHeight;
      } else {
        width = Math.round((width * maxWidthOrHeight) / height);
        height = maxWidthOrHeight;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}

export function groupBySection(
  items: ShoppingListItem[]
): Record<GrocerySection, ShoppingListItem[]> {
  const grouped = {} as Record<GrocerySection, ShoppingListItem[]>;
  for (const section of GROCERY_SECTIONS) {
    grouped[section] = [];
  }
  for (const item of items) {
    const section = item.section in grouped ? item.section : "Other";
    grouped[section].push(item);
  }
  return grouped;
}
