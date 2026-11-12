import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Decodes a base64 PDF payload and triggers a browser download. */
export function downloadBase64Pdf(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Crops an image to a centred square and shrinks it to `size` pixels, returning a data URL.
 * Profile pictures are stored in the database (Vercel has no writable disk), so they're kept
 * to a few KB instead of the multi-megabyte originals phones produce.
 */
export async function squareImageDataUrl(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("That file isn't a readable image.")); img.src = url; });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("That file isn't a readable image.");
    const target = Math.min(size, side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = target;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn't process that image.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, target, target);
    // WebP where supported (Safari falls back to PNG on its own); both are accepted by the server.
    return canvas.toDataURL("image/webp", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}
