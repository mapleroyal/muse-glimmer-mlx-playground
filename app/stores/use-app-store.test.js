import { describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/app-config";
import {
  createAppStore,
  getInitialTheme,
  getResolvedTheme,
} from "./use-app-store";

function createStorage(initialTheme = null) {
  let value = initialTheme;

  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_, nextTheme) => {
      value = nextTheme;
    }),
  };
}

describe("useAppStore", () => {
  it("getInitialTheme prefers a persisted user theme", () => {
    const storage = createStorage("dark");
    const matchMedia = vi.fn(() => ({ matches: false }));

    expect(getInitialTheme({ matchMedia, storage })).toBe("dark");
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("getInitialTheme falls back to system preference when no persisted theme exists", () => {
    const storage = createStorage();
    const matchMedia = vi.fn(() => ({ matches: true }));

    expect(getInitialTheme({ matchMedia, storage })).toBe("system");
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("getInitialTheme falls back to system when storage is unavailable", () => {
    expect(getInitialTheme()).toBe("system");
  });

  it("keeps working when browser storage rejects access", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new globalThis.DOMException("Blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new globalThis.DOMException("Blocked", "SecurityError");
      }),
    };
    const store = createAppStore({ storage });

    expect(store.getState().theme).toBe("system");
    expect(() => store.getState().setTheme("dark")).not.toThrow();
    expect(store.getState().theme).toBe("dark");
  });

  it("getResolvedTheme uses the OS preference when the user selects system", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));

    expect(getResolvedTheme("system", matchMedia)).toBe("dark");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it("store starts with persisted theme when available", () => {
    const storage = createStorage("dark");
    const store = createAppStore({ storage });

    expect(store.getState().theme).toBe("dark");
  });

  it("setTheme updates and persists theme values", () => {
    const storage = createStorage();
    const store = createAppStore({ storage });

    store.getState().setTheme("system");
    expect(store.getState().theme).toBe("system");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "system",
    );

    store.getState().setTheme("dark");
    expect(store.getState().theme).toBe("dark");
    expect(storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, "dark");

    store.getState().setTheme("light");
    expect(store.getState().theme).toBe("light");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "light",
    );
  });

  it("toggleTheme flips the resolved theme and persists an explicit choice", () => {
    const storage = createStorage("system");
    const matchMedia = vi.fn(() => ({ matches: true }));
    const store = createAppStore({ storage, matchMedia });

    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("light");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "light",
    );

    store.getState().toggleTheme();
    expect(store.getState().theme).toBe("dark");
    expect(storage.setItem).toHaveBeenLastCalledWith(THEME_STORAGE_KEY, "dark");
  });
});
