import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "./register-service-worker";
import "./globals.css";
import { AuthBoundary } from '@/components/auth/AuthBoundary';
export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for the wordmark and page titles — the "painted deli
// signage" note that keeps the app from looking like a generic template.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  title: "Kelly's Deli — Food Log",
  description: "Digital SFBB/HACCP food safety diary for Kelly's Deli.",
  robots: { index: false, follow: false, nocache: true },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Food Safety",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // let us pad with safe-area insets on home-screen PWAs
  themeColor: "#1e5b45",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <RegisterServiceWorker />
        <AuthBoundary>{children}</AuthBoundary>
      </body>
    </html>
  );
}
