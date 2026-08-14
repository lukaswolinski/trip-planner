'use client';

import { useEffect, useRef } from 'react';

interface Props {
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  /** Drives the label: pinning and unpinning share one menu slot. */
  pinned: boolean;
  onClose: () => void;
}

/**
 * The three-dot row menu in the sidebar.
 *
 * Closes on Escape, on a click anywhere outside, and after any action is chosen.
 * `pointerdown` rather than `click` for the outside check, so the menu is gone
 * before the click lands on whatever is underneath.
 */
export default function TripRowMenu({
  onRename,
  onShare,
  onDelete,
  onTogglePin,
  pinned,
  onClose,
}: Props) {
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item =
    'block w-full px-3 py-1.5 text-left text-xs hover:bg-inset';

  return (
    <div
      ref={menu}
      role="menu"
      className="absolute right-1 top-7 z-30 w-32 overflow-hidden rounded-control border border-line bg-surface py-1 shadow-lg"
    >
      <button type="button" role="menuitem" className={item} onClick={onTogglePin}>
        {pinned ? 'Unpin' : 'Pin to top'}
      </button>
      <button type="button" role="menuitem" className={item} onClick={onRename}>
        Rename
      </button>
      <button type="button" role="menuitem" className={item} onClick={onShare}>
        Share
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} text-danger hover:bg-danger-soft`}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
