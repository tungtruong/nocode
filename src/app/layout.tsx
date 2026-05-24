import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { ClientLayout } from "@/components/ClientLayout";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "nocode — Dựng app không cần code",
  description: "Mô tả ý tưởng. AI dựng web app theo thời gian thực. Một chạm để deploy.",
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
