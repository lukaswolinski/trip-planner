'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether the route line is drawn on the map, persisted across sessions.
 *
 * Hiding the line is genuinely useful: on a dense city leg the route covers the
 * streets you are trying to read, and when comparing two possible orderings the
 * pins alone are easier to scan. The numbered pins are deliberately NOT part of
 * this — they are the trip itself, not a decoration on it.
 *
 * Same store shape as the theme, the sidebar collapse and the pane width: a
 * module-level value read through useSyncExternalStore. Copying it into state
 * inside an effect causes the cascading render the React Compiler lint rejects.
 */

const STORAGE_KEY = 'tp_show_route';

let current: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (current !== null) return current;
  try {
    // Absent means "never toggled", which should show the line.
    current = localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    current = true;
  }
  return current;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Shown on the server, matching the common case.
 *
 * If this disagreed with the client's first read the map would flicker the line
 * on and off during hydration — but the map is client-only anyway, so this
 * simply keeps the two snapshots consistent.
 */
function serverSnapshot(): boolean {
  return true;
}

export function setShowRoute(next: boolean): void {
  current = next;
  listeners.forEach((listener) => listener());
  try {
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

export function useShowRoute(): boolean {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
