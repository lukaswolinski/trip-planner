import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
// Imported from a neutral module, NOT from the 'use client' ThemeProvider: a
// value imported from a client module into a Server Component becomes a
// client-reference stub, and interpolating that into the script below produced a
// syntax error on every page load.
import { DARK_MEDIA_QUERY, THEME_STORAGE_KEY } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Trip Planner — unlimited stops',
  description:
    'Plan long road trips and backpacking routes with as many stops as you like, per-leg distances and times, and a shareable read-only link.',
};

/**
 * Applies the saved appearance before the first paint.
 *
 * Without this the page would render in the default theme and then snap to the
 * chosen one once React hydrated — the "flash of wrong theme". It has to be a
 * blocking inline script for that reason, and it is kept deliberately tiny.
 */
const THEME_INIT = `
(function(){
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var pref = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    var dark = pref === 'dark' || (pref === 'system' &&
      window.matchMedia('${DARK_MEDIA_QUERY}').matches);
    var theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-theme is set by the script below before paint; "light" is only the
    // server-rendered placeholder. suppressHydrationWarning is required and
    // correct here: the script deliberately mutates these attributes before
    // React hydrates, and without it React reports a mismatch on every load.
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
