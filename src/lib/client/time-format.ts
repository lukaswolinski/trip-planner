'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether times are shown as 12-hour or 24-hour.
 *
 * `auto` asks the browser, which is right for almost everyone: someone in the
 * US expects 2:30 PM and someone in Germany expects 14:30, and neither should
 * have to configure it. The explicit settings exist because locale is a guess
 * about preference — plenty of people read a US locale and still want 24-hour.
 *
 * Same store shape as the theme, sidebar collapse, pane width and route
 * visibility: a module-level value read through useSyncExternalStore.
 */

export type TimePreference = 'auto' | '12' | '24';

const STORAGE_KEY = 'tp_time_format';

let current: TimePreference | null = null;
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is TimePreference {
  return value === 'auto' || value === '12' || value === '24';
}

function read(): TimePreference {
  if (current !== null) return current;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    current = isPreference(stored) ? stored : 'auto';
  } catch {
    current = 'auto';
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

function serverSnapshot(): TimePreference {
  return 'auto';
}

export function setTimePreference(next: TimePreference): void {
  current = next;
  listeners.forEach((listener) => listener());
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

export function useTimePreference(): TimePreference {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

/**
 * Does this browser's locale use a 12-hour clock?
 *
 * Asked by formatting a known time and looking for a day-period part, rather
 * than reading `resolvedOptions().hour12` — that property is not reliably
 * populated unless `hour12` was passed in, so inspecting the actual output is
 * the answer that matches what the user would see.
 */
export function localeUses12Hour(): boolean {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
    }).formatToParts(new Date(2020, 0, 1, 13, 0));
    return parts.some((part) => part.type === 'dayPeriod');
  } catch {
    return false;
  }
}

/** Resolves the preference into the concrete choice to render with. */
export function resolve12Hour(preference: TimePreference): boolean {
  if (preference === '12') return true;
  if (preference === '24') return false;
  return localeUses12Hour();
}
