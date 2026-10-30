// Certificates go up through /api/certificates (managers only). Photos are
// redrawn as a JPEG on the device first: smaller uploads on shop wifi, and
// it drops the photo's hidden data (location, camera) before it leaves the
// iPad. PDFs go up as they are.

const MAX_SIDE = 2000;

async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the photo"))), "image/jpeg", 0.85));
}

export async function uploadCertificate(siteId: string, file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const body = isPdf ? file : await toJpeg(file);
  const response = await fetch(`/api/certificates?site=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { "Content-Type": isPdf ? "application/pdf" : "image/jpeg" },
    body,
    credentials: "same-origin",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.path !== "string") throw new Error(result.message ?? "Upload failed. Check the internet connection.");
  return result.path;
}

export function certificateUrl(path: string): string {
  return `/api/certificates?path=${encodeURIComponent(path)}`;
}
