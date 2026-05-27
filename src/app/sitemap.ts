// Sitemap — Next.js generates /sitemap.xml from this. Submit the resulting
// URL once at https://search.google.com/search-console + Bing Webmaster
// Tools to seed initial crawl.

import type { MetadataRoute } from "next";

const BASE = "https://justvibe.me";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    // Landing — top priority, weekly changefreq since hero copy + showcase
    // get refreshed routinely.
    {
      url: `${BASE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    // Pricing — high commercial intent, updated when tiers change.
    {
      url: `${BASE}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    // Zalo Mini App guide — unique-to-JV content, ranks well for
    // "tao zalo mini app" / "zalo mini app builder" searches.
    {
      url: `${BASE}/docs/zalo-mini-app`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Community / acceptable-use rules — low priority but indexable.
    {
      url: `${BASE}/rules`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    // Login / signup are linked from the marketing pages — let crawlers
    // know they exist without prioritising them.
    {
      url: `${BASE}/login`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/signup`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
