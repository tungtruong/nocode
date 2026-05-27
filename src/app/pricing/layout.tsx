// Server-only layout shim that owns the page metadata, since
// src/app/pricing/page.tsx is a "use client" component and Next 16
// doesn't allow metadata exports from client modules.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing — Free, Pro $14.99, Max $39.99",
  description:
    "JustVibe pricing: Free tier for trying it out, Pro at $14.99/mo for serious projects, Max at $39.99/mo for agencies. Token-metered, no surprise bills, cancel anytime.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "JustVibe Pricing — Free, Pro $14.99, Max $39.99",
    description:
      "AI no-code app builder with predictable pricing. Free to try; Pro $14.99/mo for small businesses; Max $39.99/mo for agencies. Includes hosting, custom domain, Zalo Mini App export.",
    url: "https://justvibe.me/pricing",
    type: "website",
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
