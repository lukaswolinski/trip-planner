'use client';

import { useSyncExternalStore } from 'react';

/**
 * Width of the stop-list pane, persisted across sessions.
 *
 * Held in a module-level store read through useSyncExternalStore rather than
 * copied into state in an effect — same reason as the theme and the sidebar
 * collapse. localStorage writes are debounced because a drag fires many updates
 * per second and there is no need to hit storage on each one.
 */

const STORAGE_KEY = 'tp_pane_width';

/** Comfortable default: wide enough for the notes box, still leaves a big map. */
export const PANE_DEFAULT = 440;
export const PANE_MIN = 320;
/**
 * Just past the "Travel to next" dropdown — beyond this the pane is only adding
 * empty space, and the map is the thing worth the pixels.
 */
export const PANE_MAX = 520;

let current: number | null = null;
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function clamp(value: number): number {
  if (!Number.isFinite(value)) return PANE_DEFAULT;
  return Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(value)));
}

function read(): number {
  if (current !== null) return current;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    current = raw ? clamp(Number(raw)) : PANE_DEFAULT;
  } catch {
    current = PANE_DEFAULT;
  }
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Must match the server render, or hydration disagrees on the layout. */
function serverSnapshot(): number {
  return PANE_DEFAULT;
}

export function setPaneWidth(width: number): void {
  current = clamp(width);
  listeners.forEach((listener) => listener());

  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(current));
    } catch {
      // Non-fatal: the width just will not survive a reload.
    }
  }, 250);
}

export function usePaneWidth(): number {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
