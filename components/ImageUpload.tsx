"use client";

import { useRef } from "react";
import { Camera, Upload } from "lucide-react";

interface Props {
  onImage: (base64: string) => void;
  label?: string;
  accept?: string;
  className?: string;
}

export default function ImageUpload({ onImage, label = "Upload photo", accept = "image/*", className = "" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const { compressImage } = await import("@/lib/utils");
    const base64 = await compressImage(file);
    onImage(base64);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  }

  return (
    <div
      className={`border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 p-6 cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors ${className}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="flex gap-3 text-gray-400">
        <Camera size={28} />
        <Upload size={28} />
      </div>
      <p className="text-sm font-medium text-gray-600">{label}</p>
      <p className="text-xs text-gray-400">Tap or drag & drop</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        capture="environment"
      />
    </div>
  );
}
