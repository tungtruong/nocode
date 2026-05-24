"use client";

import { LangProvider } from "@/components/LangProvider";
import type { Lang } from "@/lib/i18n";

export function ClientLayout({ children, initialLang }: { children: React.ReactNode; initialLang: Lang }) {
  return <LangProvider initialLang={initialLang}>{children}</LangProvider>;
}
