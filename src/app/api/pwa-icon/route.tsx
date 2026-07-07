import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { AppIconGlyph } from "@/lib/branding/appIcon";

// Generates the 192x192 / 512x512 PNGs referenced by manifest.ts icons.
// A dedicated route (rather than the icon/apple-icon conventions) because
// the manifest needs specific pixel sizes for Android/Chrome installability.
export async function GET(request: NextRequest) {
  const sizeParam = request.nextUrl.searchParams.get("size");
  const dimension = sizeParam === "512" ? 512 : 192;

  return new ImageResponse(<AppIconGlyph fontSize={dimension / 2} />, {
    width: dimension,
    height: dimension,
  });
}
