import type { NextConfig } from "next";

// Security headers applied to ALL routes except /apps/* (deployed apps already
// inject their own restrictive CSP via meta tag inside the iframe).
// Note: Next 16 + Tailwind v4 needs 'unsafe-inline' for boot scripts/styles; in
// dev mode 'unsafe-eval' is required for React Fast Refresh.
const isDev = process.env.NODE_ENV !== "production";

const PARENT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
  "font-src 'self' data: fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: PARENT_CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Stricter than frame-ancestors to also catch ancient browsers that ignore CSP.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Applies to every route. The sandboxed user app inside /apps/[id]'s
        // iframe has its own meta CSP injected by the page component, which is
        // independent of these parent headers.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
