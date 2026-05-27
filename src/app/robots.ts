// Robots policy — see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
//
// Allow indexing of marketing pages; disallow API, admin, and the
// auth-gated builder/dashboard surfaces (no SEO value, may confuse crawlers).
// Disallow /apps/<id> too — those are individual user-deployed sites and
// we don't want JV's domain ranking for their content; each app is at
// its own <slug>.justvibe.me subdomain anyway.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/builder",
          "/dashboard",
          "/dashboard/",
          "/apps/",
          "/f/",
        ],
      },
    ],
    sitemap: "https://justvibe.me/sitemap.xml",
    host: "https://justvibe.me",
  };
}
