import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Community rules & acceptable use",
  description:
    "JustVibe community rules — what kinds of apps we will and won't generate. Covers prompt safety, prohibited content, and how we handle violations.",
  alternates: { canonical: "/rules" },
  robots: { index: true, follow: true },
};

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
