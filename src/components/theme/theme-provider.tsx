"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeCtx {
  theme: Theme;
  effective: "light" | "dark";
  setTheme: (t: Theme) => void;
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = "momentum:theme";

function resolve(t: Theme): boolean {
  return (
    t === "dark" ||
    (t === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

function apply(t: Theme) {
  document.documentElement.classList.toggle("dark", resolve(t));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // First render is always "system" on both server and client so hydration
  // matches; the stored preference is reconciled in an effect after mount.
  const [theme, setThemeState] = useState<Theme>("system");
  const [effective, setEffective] = useState<"light" | "dark">("light");
  const skipApply = useRef(true);

  // Reconciliation after mount (avoids a hydration mismatch). The DOM
  // class is applied synchronously — the init script already did this
  // pre-paint — while state is reconciled on the next frame.
  useEffect(() => {
    const stored = readStored();
    apply(stored);
    const id = window.requestAnimationFrame(() => {
      setThemeState(stored);
      setEffective(resolve(stored) ? "dark" : "light");
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Apply on explicit changes only (first run is handled above).
  useEffect(() => {
    if (skipApply.current) {
      skipApply.current = false;
      return;
    }
    apply(theme);
    setEffective(resolve(theme) ? "dark" : "light");
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      apply("system");
      setEffective(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      effective,
      setTheme: setThemeState,
      cycle: () => {
        const order: Theme[] = ["system", "dark", "light"];
        const i = order.indexOf(theme);
        setThemeState(order[(i + 1) % order.length]);
      },
    }),
    [theme, effective],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
