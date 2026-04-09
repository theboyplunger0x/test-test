import { useState, useEffect } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "fud_theme";

/**
 * App theme (dark / light) persisted in localStorage.
 *
 * Returns the current theme, setter, toggle and `dk` boolean helper.
 */
export function useAppTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  return {
    theme,
    setTheme,
    toggle,
    dk: theme === "dark",
  };
}
