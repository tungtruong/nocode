"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";

function setCookieLang(lang: Lang) {
  document.cookie = `lang=${lang};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

const LangCtx = createContext<{ lang: Lang; toggle: () => void; t: Record<string, string> }>({
  lang: "en" as Lang,
  toggle: () => {},
  t: t.en as unknown as Record<string, string>,
});

export function LangProvider({ children, initialLang }: { children: ReactNode; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  const toggle = () => {
    setLang((prev) => {
      const next = prev === "vi" ? "en" : "vi";
      setCookieLang(next);
      return next;
    });
  };

  return (
    <LangCtx.Provider value={{ lang, toggle, t: t[lang] as unknown as Record<string, string> }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useLang() {
  return useContext(LangCtx);
}

export function LangToggle() {
  const { lang, toggle } = useLang();
  return (
    <button
      onClick={toggle}
      className="rounded-lg px-2 py-1 text-xs font-medium text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f1f5f9] transition-all"
    >
      {lang === "vi" ? "EN" : "VI"}
    </button>
  );
}
