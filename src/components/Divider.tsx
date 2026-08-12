'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared look for the vertical dividers: a hairline that widens into a visible
 * grip on hover, with a hit area wider than the line itself so it is actually
 * grabbable. Used by both the resizable editor/map divider and the sidebar's
 * collapse handle, so the two read as the same control.
 */
const BASE =
  'group relative flex w-2 shrink-0 items-center justify-center outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-blue-500';

const LINE =
  'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/10 transition-colors ' +
  'group-hover:bg-blue-500/60 dark:bg-white/10 dark:group-hover:bg-blue-400/60';

const GRIP =
  'pointer-events-none relative h-8 w-1 rounded-full bg-black/15 opacity-0 transition-opacity ' +
  'group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-white/25';

interface DragDividerProps {
  /** Current width of the element to the left, in pixels. */
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  /** Announced to screen readers, e.g. "Resize stop list". */
  label: string;
}

/**
 * Draggable vertical divider.
 *
 * Uses pointer capture so the drag keeps tracking even when the cursor leaves
 * the handle — without it, moving fast drops the drag. Arrow keys resize too, so
 * this is not mouse-only.
 */
export function DragDivider({ width, min, max, onChange, label }: DragDividerProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, value)),
    [min, max],
  );

  // While dragging, suppress text selection and keep the resize cursor even when
  // the pointer strays over other elements.
  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`${BASE} cursor-col-resize`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        startX.current = event.clientX;
        startWidth.current = width;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        onChange(clamp(startWidth.current + (event.clientX - startX.current)));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          onChange(clamp(width - step));
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          onChange(clamp(width + step));
        }
      }}
    >
      <span className={LINE} aria-hidden />
      <span className={`${GRIP} ${dragging ? 'opacity-100' : ''}`} aria-hidden />
    </div>
  );
}

interface HandleDividerProps {
  onClick: () => void;
  label: string;
  expanded: boolean;
}

/**
 * Divider that acts as a button — used for the sidebar collapse toggle.
 *
 * Visually identical to DragDivider so the edges of the layout look consistent;
 * it replaced a chunky bordered box with an undersized arrow glyph.
 */
export function HandleDivider({ onClick, label, expanded }: HandleDividerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      title={label}
      className={`${BASE} cursor-pointer`}
    >
      <span className={LINE} aria-hidden />
      <span className={GRIP} aria-hidden />
    </button>
  );
}
