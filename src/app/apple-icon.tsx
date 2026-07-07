import { ImageResponse } from "next/og";
import { AppIconGlyph } from "@/lib/branding/appIcon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIconGlyph fontSize={90} />, size);
}
