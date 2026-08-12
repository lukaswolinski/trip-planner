'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  DARK_MEDIA_QUERY,
  isThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

export type { ResolvedTheme, ThemePreference };

/*
 * Both the saved preference (localStorage) and the OS setting (matchMedia) are
 * external stores, so they are read with useSyncExternalStore rather than copied
 * into state inside an effect. Doing the latter causes a cascading render on
 * mount and is what the React Compiler lint correctly rejects.
 */

const preferenceListeners = new Set<() => void>();

function subscribePreference(onChange: () => void): () => void {
  preferenceListeners.add(onChange);
  // A change in another tab should be picked up here too.
  window.addEventListener('storage', onChange);
  return () => {
    preferenceListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function preferenceSnapshot(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    // Storage blocked (private mode) — follow the system instead.
  }
  return 'system';
}

/** Must match what the server rendered, so hydration agrees. */
function preferenceServerSnapshot(): ThemePreference {
  return 'system';
}

function writePreference(next: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Non-fatal: the choice simply will not survive a reload.
  }
  preferenceListeners.forEach((listener) => listener());
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_MEDIA_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function systemSnapshot(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

function systemServerSnapshot(): ResolvedTheme {
  return 'light';
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the appearance setting for the whole app.
 *
 * The single source of truth is the `data-theme` attribute on `<html>`, which
 * every Tailwind `dark:` class keys off (see the @custom-variant in globals.css),
 * and which also drives the CSS variables and the map basemap. That is why the
 * setting controls the entire UI rather than only the panel that changes it.
 *
 * The initial value is applied by an inline script in the layout, before first
 * paint, so there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribePreference,
    preferenceSnapshot,
    preferenceServerSnapshot,
  );

  const systemValue = useSyncExternalStore(
    subscribeSystem,
    systemSnapshot,
    systemServerSnapshot,
  );

  const resolved: ResolvedTheme = preference === 'system' ? systemValue : preference;

  // Writing to the document is synchronising an external system with React
  // state, which is exactly what an effect is for.
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    writePreference(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
