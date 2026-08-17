'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';
import type { ThemePreference } from '@/lib/theme';
import {
  resolve12Hour,
  setTimePreference,
  useTimePreference,
  type TimePreference,
} from '@/lib/client/time-format';

interface Props {
  onClose: () => void;
}

const OPTIONS: Array<{ value: ThemePreference; label: string; hint: string }> = [
  { value: 'system', label: 'System', hint: 'Match your device setting' },
  { value: 'light', label: 'Light', hint: 'Always light' },
  { value: 'dark', label: 'Dark', hint: 'Always dark' },
];

const TIME_OPTIONS: Array<{ value: TimePreference; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Match your browser’s language' },
  { value: '12', label: '12-hour', hint: '2:30 PM' },
  { value: '24', label: '24-hour', hint: '14:30' },
];

/**
 * Settings. Appearance only, by design — more sections can be added later.
 *
 * The panel stays open until it is explicitly dismissed: choosing an option
 * applies immediately and does not close or navigate, so a setting can be
 * changed and its effect seen without the panel vanishing.
 */
export default function SettingsPanel({ onClose }: Props) {
  const { preference, resolved, setPreference } = useTheme();
  const timePreference = useTimePreference();
  const dialog = useRef<HTMLDivElement | null>(null);

  // Escape to close, and move focus into the panel for keyboard users.
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-inset p-4 pt-20"
      onClick={onClose}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="settings-title" className="text-base font-semibold">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-sm opacity-60 hover:bg-inset hover:opacity-100"
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Appearance
          </legend>

          <div className="mt-2 space-y-1">
            {OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2 text-sm ${
                    selected
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-inset'
                  }`}
                >
                  <input
                    type="radio"
                    name="appearance"
                    value={option.value}
                    checked={selected}
                    onChange={() => setPreference(option.value)}
                    className="accent-blue-600"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-xs text-ink-muted">
                      {option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Currently showing the {resolved} theme
            {preference === 'system' ? ' (from your device)' : ''}. This also
            switches the map basemap.
          </p>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Time format
          </legend>

          <div className="mt-2 space-y-1">
            {TIME_OPTIONS.map((option) => {
              const selected = timePreference === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2 text-sm ${
                    selected
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-inset'
                  }`}
                >
                  <input
                    type="radio"
                    name="time-format"
                    value={option.value}
                    checked={selected}
                    onChange={() => setTimePreference(option.value)}
                    className="accent-blue-600"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="block text-xs text-ink-muted">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Itinerary times are shown as{' '}
            {resolve12Hour(timePreference) ? '2:30 PM' : '14:30'}
            {timePreference === 'auto' ? ', from your browser’s language' : ''}.
          </p>
        </fieldset>
      </div>
    </div>
  );
}
