'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/client/api';
import SettingsButton from './SettingsButton';
import ConfirmDialog from './ConfirmDialog';
import TripRowMenu from './TripRowMenu';
import { HandleDivider } from './Divider';
import { formatStopCount } from '@/lib/format';
import type { TripListItem } from '@/types';

interface Props {
  trips: TripListItem[];
  claimed: boolean;
  email: string | null;
  children: ReactNode;
}

/*
 * Sidebar collapse lives in localStorage and is read through
 * useSyncExternalStore — the same pattern as the theme. Copying it into state
 * inside an effect causes a cascading render on mount, which the React Compiler
 * lint rejects.
 */
const COLLAPSE_KEY = 'tp_sidebar_collapsed';
const collapseListeners = new Set<() => void>();

function subscribeCollapse(onChange: () => void): () => void {
  collapseListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    collapseListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function collapseSnapshot(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Expanded on the server, so the first paint matches the common case. */
function collapseServerSnapshot(): boolean {
  return false;
}

function setCollapsed(next: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
  collapseListeners.forEach((listener) => listener());
}

/**
 * Chat-style three-pane shell: trip history on the left, the editor in the
 * middle, the map on the right.
 *
 * The sidebar lives in a route-group layout rather than in each page, so it
 * keeps its scroll position and collapse state across navigation instead of
 * re-mounting. `router.refresh()` is what pulls fresh trips into it after a
 * create or delete.
 */
export default function AppShell({ trips, claimed, email, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    collapseSnapshot,
    collapseServerSnapshot,
  );

  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TripListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row's three-dot menu is open. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** Which row is being renamed inline, and the draft text. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  async function commitRename() {
    if (!renaming) return;
    const target = allTrips.find((t) => t.id === renaming.id);
    const title = renaming.value.trim();
    setRenaming(null);
    if (!target || title === '' || title === target.title) return;

    try {
      await api.patchTrip(target.id, { title, version: target.version });
      router.refresh();
    } catch (err) {
      // A stale version means the trip changed elsewhere; retry once with the
      // server's value, exactly as the editor's title field does.
      if (err instanceof ApiError && err.isConflict && err.body.currentVersion !== undefined) {
        try {
          await api.patchTrip(target.id, {
            title,
            version: err.body.currentVersion,
          });
          router.refresh();
          return;
        } catch {
          /* fall through */
        }
      }
      setError('Could not rename that trip.');
    }
  }

  /**
   * Trips created in this session, shown immediately.
   *
   * `router.refresh()` is asynchronous and the sidebar is a persistent server
   * layout, so a newly created trip could take a while to appear — in practice it
   * only showed up after some later action forced another refresh. Holding the
   * new trip locally makes it appear the instant it exists; the server list
   * supersedes it as soon as it catches up.
   */
  const [optimistic, setOptimistic] = useState<TripListItem[]>([]);

  // Not manually memoized: these lists are tiny, and the React Compiler handles
  // the memoization itself (it rejects hand-written useMemo it cannot preserve).
  const serverIds = new Set(trips.map((t) => t.id));
  const allTrips = [...optimistic.filter((t) => !serverIds.has(t.id)), ...trips];

  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? allTrips.filter((trip) => trip.title.toLowerCase().includes(needle))
    : allTrips;

  /*
   * Sorted client-side as well as in SQL. The server already returns pinned
   * first, but an optimistically-added trip is prepended locally and a pin
   * toggle updates local state before the refresh lands — without this the row
   * would visibly sit in the wrong place until the server caught up.
   */
  const visible = [...matching].sort((a, b) => {
    if (!a.pinnedAt !== !b.pinnedAt) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  async function togglePin(trip: TripListItem) {
    const pinned = !trip.pinnedAt;
    // Reflect it immediately; the refresh below replaces this with the truth.
    setOptimistic((current) => {
      const others = current.filter((t) => t.id !== trip.id);
      return [
        { ...trip, pinnedAt: pinned ? new Date().toISOString() : null },
        ...others,
      ];
    });
    try {
      await api.patchTrip(trip.id, { pinned, version: trip.version });
      router.refresh();
    } catch {
      setError(pinned ? 'Could not pin that trip.' : 'Could not unpin that trip.');
      setOptimistic((current) => current.filter((t) => t.id !== trip.id));
    }
  }

  async function createTrip() {
    setCreating(true);
    try {
      const { trip } = await api.createTrip({});
      // Show it straight away rather than waiting on the server round trip.
      setOptimistic((current) => [
        {
          id: trip.id,
          title: trip.title,
          defaultProfile: trip.defaultProfile,
          shareSlug: trip.shareSlug,
          version: trip.version,
          updatedAt: trip.updatedAt,
          stopCount: 0,
          pinnedAt: null,
        },
        ...current,
      ]);
      /*
       * refresh() before push(), not after: refresh() re-fetches the *current*
       * route, so calling it afterwards raced with the navigation and could
       * cancel it.
       */
      router.refresh();
      router.push(`/trips/${trip.id}`);
    } catch {
      setError('Could not create a trip.');
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const wasOpen = pathname === `/trips/${pendingDelete.id}`;
    try {
      await api.deleteTrip(pendingDelete.id);
      // Drop it from the optimistic list too, or a just-created trip would
      // linger in the sidebar after being deleted.
      setOptimistic((current) => current.filter((t) => t.id !== pendingDelete.id));
      setPendingDelete(null);
      // Leaving the editor open on a deleted trip would 404 on next load.
      if (wasOpen) router.push('/');
      router.refresh();
    } catch {
      setError('Could not delete that trip.');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`flex shrink-0 flex-col bg-black/[0.02] transition-[width] duration-150 dark:bg-white/[0.03] ${
          collapsed ? 'w-14' : 'w-72'
        }`}
      >
        {/*
         * The collapse control moved out to the sidebar's right edge as a
         * divider-style handle, so this row is just the new-trip button.
         */}
        <div className="p-2">
          {collapsed ? (
            <button
              type="button"
              onClick={createTrip}
              disabled={creating}
              title="New trip"
              aria-label="New trip"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-lg leading-none text-white hover:bg-blue-700 disabled:opacity-60"
            >
              +
            </button>
          ) : (
            <button
              type="button"
              onClick={createTrip}
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {creating ? 'Creating…' : '+ New trip'}
            </button>
          )}
        </div>

        {/* Filter */}
        {!collapsed ? (
          <div className="px-2 pb-2">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search trips"
              aria-label="Search trips"
              className="w-full rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-sm outline-none placeholder:text-black/40 focus:border-blue-500 dark:border-white/20 dark:bg-white/[0.06] dark:placeholder:text-white/40"
            />
          </div>
        ) : null}

        {/* Trip history */}
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2"
          aria-label="Trip history"
        >
          {collapsed ? (
            <ul className="space-y-1">
              {allTrips.slice(0, 12).map((trip, index) => {
                const active = pathname === `/trips/${trip.id}`;
                return (
                  <li key={trip.id}>
                    <Link
                      href={`/trips/${trip.id}`}
                      title={trip.title}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-medium ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                    >
                      {index + 1}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : allTrips.length === 0 ? (
            <p className="px-1 py-4 text-xs text-black/45 dark:text-white/45">
              No trips yet. Create one to get started.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-4 text-xs text-black/45 dark:text-white/45">
              No trips match “{filter}”.
            </p>
          ) : (
            <ul className="space-y-0.5 pb-2">
              {visible.map((trip) => {
                const active = pathname === `/trips/${trip.id}`;
                const isRenaming = renaming?.id === trip.id;

                return (
                  <li key={trip.id} className="group relative">
                    {isRenaming ? (
                      // Inline rename: Enter commits, Escape abandons, blur commits
                      // so clicking away does the expected thing.
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(event) =>
                          setRenaming({ id: trip.id, value: event.target.value })
                        }
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitRename();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setRenaming(null);
                          }
                        }}
                        aria-label={`Rename ${trip.title}`}
                        className="w-full rounded-lg border border-blue-500 bg-white px-2.5 py-2 text-sm outline-none dark:bg-white/[0.08]"
                      />
                    ) : (
                      <>
                        <Link
                          href={`/trips/${trip.id}`}
                          className={`block rounded-lg px-2.5 py-2 pr-8 ${
                            active
                              ? 'bg-blue-600/10 ring-1 ring-blue-500/40 dark:bg-blue-500/15'
                              : 'hover:bg-black/5 dark:hover:bg-white/10'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {trip.pinnedAt ? (
                              <span
                                aria-label="Pinned"
                                title="Pinned to the top"
                                className="shrink-0 text-[11px] leading-none text-blue-600 dark:text-blue-400"
                              >
                                ●
                              </span>
                            ) : null}
                            <span className="block truncate text-sm font-medium">
                              {trip.title}
                            </span>
                          </span>
                          <span className="block text-xs text-black/45 dark:text-white/45">
                            {formatStopCount(trip.stopCount)}
                            {trip.shareSlug ? ' · shared' : ''}
                          </span>
                        </Link>

                        <button
                          type="button"
                          onClick={() =>
                            setMenuFor((current) => (current === trip.id ? null : trip.id))
                          }
                          aria-label={`Actions for ${trip.title}`}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === trip.id}
                          title="More"
                          className={`absolute right-1 top-1.5 rounded px-1.5 py-1 text-sm leading-none text-black/45 hover:bg-black/10 focus:opacity-100 dark:text-white/45 dark:hover:bg-white/15 ${
                            menuFor === trip.id
                              ? 'opacity-100'
                              : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          ⋯
                        </button>

                        {menuFor === trip.id ? (
                          <TripRowMenu
                            onClose={() => setMenuFor(null)}
                            pinned={!!trip.pinnedAt}
                            onTogglePin={() => {
                              setMenuFor(null);
                              void togglePin(trip);
                            }}
                            onRename={() => {
                              setMenuFor(null);
                              setRenaming({ id: trip.id, value: trip.title });
                            }}
                            onShare={() => {
                              setMenuFor(null);
                              // The editor opens its share dialog on ?share=1.
                              router.push(`/trips/${trip.id}?share=1`);
                            }}
                            onDelete={() => {
                              setMenuFor(null);
                              setPendingDelete(trip);
                            }}
                          />
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Pinned bottom: profile + settings */}
        <div className="border-t border-black/10 p-2 dark:border-white/10">
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                title={email ?? 'Not signed in'}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/15"
              >
                {(email?.[0] ?? '?').toUpperCase()}
              </div>
              <SettingsButton />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/15">
                {(email?.[0] ?? '?').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {email ?? 'Not signed in'}
                </p>
                <p className="text-[11px] text-black/45 dark:text-white/45">
                  {claimed ? 'Trips saved to your account' : 'Saved to this browser'}
                </p>
              </div>
              <SettingsButton />
            </div>
          )}
        </div>
      </aside>

      {/*
       * Collapse handle on the sidebar's edge, styled identically to the
       * editor/map resize divider so both seams read as the same control.
       */}
      <HandleDivider
        expanded={!collapsed}
        label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={() => setCollapsed(!collapsed)}
      />

      {/* Main + map. Each page decides how to split this. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {error ? (
          <div className="flex items-start justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-xs text-red-900 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-100">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">{children}</div>
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete “${pendingDelete.title}”?`}
          message={`This can't be undone. ${formatStopCount(
            pendingDelete.stopCount,
          )} will be deleted with it.`}
          confirmLabel="Delete trip"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
