import { useLayoutEffect } from "react";

import { getResolvedTheme, useAppStore } from "@/stores/use-app-store";

export function ThemeSync() {
  const theme = useAppStore((state) => state.theme);

  useLayoutEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    const mediaQuery = matchMedia?.("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolvedTheme = getResolvedTheme(theme, matchMedia);

      document.documentElement.classList.toggle(
        "dark",
        resolvedTheme === "dark",
      );
      document.documentElement.style.colorScheme = resolvedTheme;
    };

    applyTheme();

    if (theme !== "system" || !mediaQuery) {
      return undefined;
    }

    mediaQuery.addEventListener("change", applyTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, [theme]);

  return null;
}
