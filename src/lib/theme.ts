/**
 * Theme constants and types, in a module with NO `'use client'` directive.
 *
 * This separation is load-bearing. When a Server Component imports a non-component
 * value from a `'use client'` module, Next replaces it with a client-reference
 * stub — so interpolating such a "constant" into the inline theme script emitted
 * a function body containing `throw new Error("Attempted to call … from the
 * server")` straight into a string literal, producing a JavaScript syntax error
 * on every page load. Keeping shared constants in a neutral module is the fix.
 */

/** What the user chose. "system" follows the operating system setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** What is actually applied — "system" is always resolved to one of these. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'tp_theme';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}
