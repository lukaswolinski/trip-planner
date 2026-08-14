import type { ReactNode } from 'react';

/**
 * Shared UI primitives.
 *
 * These exist because the app previously spelled the same button five different
 * ways — different padding, radius, border colour and hover state in each
 * component. A control's appearance now has exactly one definition, so changing
 * it changes it everywhere.
 *
 * Deliberately class strings rather than wrapper components: most call sites
 * need a plain <button> or <a> with the right look, and passing a className is
 * simpler and keeps the underlying element (and its a11y) visible at the call
 * site.
 */

const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45';

const controlBase =
  'inline-flex items-center justify-center gap-1.5 rounded-control text-sm font-medium ' +
  `transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${focus}`;

export const button = {
  /** The one primary action on a screen. */
  primary: `${controlBase} bg-accent px-3.5 py-2 text-accent-ink hover:bg-accent-hover`,
  /** Everything else with a visible edge. */
  secondary: `${controlBase} border border-line bg-surface px-3 py-1.5 text-ink hover:bg-inset`,
  /** Low emphasis: no chrome until hover. */
  ghost: `${controlBase} px-2.5 py-1.5 text-ink-muted hover:bg-inset hover:text-ink`,
  /** Square icon-only, matching `secondary`'s height. */
  icon: `${controlBase} h-8 w-8 border border-line bg-surface text-ink-muted hover:bg-inset hover:text-ink`,
  /** Icon-only with no chrome until hover — row actions, close buttons. */
  iconGhost: `${controlBase} h-7 w-7 text-ink-faint hover:bg-inset hover:text-ink`,
  danger: `${controlBase} bg-danger px-3.5 py-2 text-white hover:opacity-90`,
} as const;

export const input =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors hover:border-line-strong ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

/** Compact variant for inline controls inside a card. */
export const inputCompact =
  'rounded-control border border-line bg-surface px-2 py-1 text-sm text-ink ' +
  'placeholder:text-ink-faint transition-colors hover:border-line-strong ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

export const card = 'rounded-card border border-line bg-surface';

/** The 11px tracked caption that sits above a figure. */
export const microLabel =
  'text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint';

/**
 * A composed empty state: what belongs here, and how to put it there.
 *
 * Bare placeholder text reads as something that failed to load. A heading, a
 * sentence and an action make it read as a deliberate starting point instead.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-xs text-[13px] leading-relaxed text-ink-muted">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A grey bar standing in for a value that is still being computed. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}
