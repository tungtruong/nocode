import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { ClientLayout } from "@/components/ClientLayout";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// SEO metadata — switched to English per user request to broaden organic
// reach. The Vietnamese audience already discovers us through direct
// channels (Zalo, Facebook groups); English SERP queries like "AI app
// builder", "no-code Vietnam", "Zalo mini app generator" are where we lose
// out. Keep brand name first so VN users can still recognise it.
export const metadata: Metadata = {
  metadataBase: new URL("https://justvibe.me"),
  title: {
    default: "JustVibe — AI No-Code App Builder for Vietnam",
    template: "%s — JustVibe",
  },
  description:
    "Describe an app, get a live web app in 30 seconds. AI generates a deployable site you can publish to your own domain or as a Zalo Mini App — no code, no setup, free subdomain hosting included.",
  keywords: [
    "AI app builder",
    "no-code Vietnam",
    "vibe coding",
    "Zalo Mini App generator",
    "AI web app generator",
    "Vietnamese SMB tools",
    "VietQR payment app",
    "JustVibe",
  ],
  authors: [{ name: "JustVibe" }],
  alternates: {
    canonical: "/",
    languages: { vi: "/", en: "/" },
  },
  openGraph: {
    type: "website",
    url: "https://justvibe.me",
    siteName: "JustVibe",
    title: "JustVibe — AI No-Code App Builder for Vietnam",
    description:
      "Describe an app, get a live web app in 30 seconds. AI builds it, you deploy in one click. Custom domains, Zalo Mini App export, VietQR payment built in.",
  },
  twitter: {
    card: "summary_large_image",
    title: "JustVibe — AI No-Code App Builder for Vietnam",
    description:
      "Describe an app, get a live web app in 30 seconds. Deploy to your own domain or Zalo Mini App. No code required.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

// Explicit viewport so iOS Safari renders at device width + scales properly.
// `themeColor` keeps the URL bar tinted to match our brand purple on Android.
// Do NOT lock initialScale or set maximumScale — pinch-zoom is an a11y need.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#7c3aed",
};

async function detectLang(): Promise<"vi" | "en"> {
  // Cookie takes priority
  const cookieStore = await cookies();
  const langCookie = cookieStore.get("lang")?.value;
  if (langCookie === "vi" || langCookie === "en") return langCookie;

  // Accept-Language header
  try {
    const headersList = await headers();
    const al = headersList.get("accept-language") || "";
    if (al.includes("vi")) return "vi";
  } catch {}

  return "en";
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const lang = await detectLang();
  return (
    <html lang={lang} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ClientLayout initialLang={lang}>{children}</ClientLayout>
      </body>
    </html>
  );
}
