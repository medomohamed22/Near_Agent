"use client";
import { useSyncExternalStore } from "react";
import type { Lang } from "./i18n";

export type Theme = "light" | "dark";

// Language and theme live on <html> (set before first paint by the boot script
// in app/layout.tsx) and in localStorage. Defaults: English, light.
const EVENT = "carpass-prefs";
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};
const save = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private mode: the choice lasts for this visit only */ }
  window.dispatchEvent(new Event(EVENT));
};

export function useLang(): [Lang, (next: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, () => (document.documentElement.lang === "ar" ? "ar" : "en") as Lang, () => "en" as Lang);
  return [lang, (next) => {
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    save("carpass-lang", next);
  }];
}

export function useTheme(): [Theme, (next: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light") as Theme, () => "light" as Theme);
  return [theme, (next) => {
    document.documentElement.dataset.theme = next;
    save("carpass-theme", next);
  }];
}
