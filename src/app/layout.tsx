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

// JSON-LD structured data — drives rich snippets in SERP. We declare both
// Organization (for brand panel + sitelinks) and SoftwareApplication (for
// "AppOffer" rich result with rating + price). Inlined into <head> via a
// <script type="application/ld+json"> — same shape the Google docs example
// uses. Single source of truth; per-page schema can extend later.
const JSONLD = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "JustVibe",
    url: "https://justvibe.me",
    logo: "https://justvibe.me/favicon.ico",
    description: "AI no-code app builder for Vietnamese SMBs.",
    sameAs: [],
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "JustVibe",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "No-code app builder",
    operatingSystem: "Web",
    url: "https://justvibe.me",
    description:
      "Describe an app, get a live web app in 30 seconds. AI generates a deployable site you can publish to your own domain or as a Zalo Mini App.",
    offers: [
      { "@type": "Offer", name: "Free",  price: "0",     priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro",   price: "14.99", priceCurrency: "USD" },
      { "@type": "Offer", name: "Max",   price: "39.99", priceCurrency: "USD" },
    ],
    featureList: [
      "AI single-prompt web app generation",
      "One-click deploy to subdomain",
      "Custom domain via Cloudflare for SaaS",
      "Zalo Mini App export",
      "VietQR payment built in",
      "Visual editor (no code)",
    ],
  },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const lang = await detectLang();
  return (
    <html lang={lang} className={`${inter.variable} h-full antialiased`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSONLD) }}
        />
      </head>
      <body className="min-h-full">
        <ClientLayout initialLang={lang}>{children}</ClientLayout>
      </body>
    </html>
  );
}
