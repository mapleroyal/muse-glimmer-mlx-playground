import { create } from "zustand";

import { THEME_STORAGE_KEY } from "@/lib/app-config";

const DARK_MODE_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export const THEMES = ["system", "light", "dark"];

export function isTheme(value) {
  return THEMES.includes(value);
}

function resolveStorage(storage) {
  return storage ?? globalThis?.window?.localStorage;
}

export function getStoredTheme(storage) {
  try {
    const resolvedStorage = resolveStorage(storage);

    if (typeof resolvedStorage?.getItem !== "function") {
      return null;
    }

    const storedTheme = resolvedStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(storedTheme) ? storedTheme : null;
  } catch {
    return null;
  }
}

export function setStoredTheme(theme, storage) {
  if (!isTheme(theme)) {
    return;
  }

  try {
    const resolvedStorage = resolveStorage(storage);

    if (typeof resolvedStorage?.setItem !== "function") {
      return;
    }

    resolvedStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable in private or locked-down browser contexts.
  }
}

export function getSystemTheme(matchMedia) {
  const resolveMatchMedia = matchMedia ?? globalThis?.window?.matchMedia;

  if (typeof resolveMatchMedia !== "function") {
    return "light";
  }

  return resolveMatchMedia(DARK_MODE_MEDIA_QUERY).matches ? "dark" : "light";
}

export function getResolvedTheme(theme, matchMedia) {
  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return getSystemTheme(matchMedia);
}

export function getInitialTheme({ storage } = {}) {
  return getStoredTheme(storage) ?? "system";
}

export function createAppStore({ matchMedia, storage } = {}) {
  return create((set, get) => ({
    theme: getInitialTheme({ storage }),
    setTheme: (theme) => {
      if (!isTheme(theme)) {
        return;
      }

      set({ theme });
      setStoredTheme(theme, storage);
    },
    toggleTheme: () => {
      const nextTheme =
        getResolvedTheme(get().theme, matchMedia) === "dark" ? "light" : "dark";

      set({ theme: nextTheme });
      setStoredTheme(nextTheme, storage);
    },
  }));
}

export const useAppStore = createAppStore();
