'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/client/api';
import StopList from './StopList';
import StopSearch from './StopSearch';
import TotalsBar from './TotalsBar';
import ShareDialog from './ShareDialog';
import ClaimBanner from './ClaimBanner';
import TripMap from './TripMap';
import ConfirmDialog from './ConfirmDialog';
import { DragDivider } from './Divider';
import {
  PANE_MAX,
  PANE_MIN,
  setPaneWidth,
  usePaneWidth,
} from '@/lib/client/pane-width';
import { formatCoordinates } from '@/lib/coords';
import { EmptyState } from './ui';
import BudgetPanel from './BudgetPanel';
import type { GeocodeHit, StopDto, SummaryDto, TripDto } from '@/types';
import type { TravelProfile } from '@/lib/limits';

interface Props {
  trip: TripDto;
  initialStops: StopDto[];
  /**
   * Computed on the server so totals and per-leg figures render with the HTML
   * instead of popping in after a client round trip. Null when the initial
   * routing call failed, in which case the first user action recomputes.
   */
  initialSummary: SummaryDto | null;
  claimed: boolean;
  softCap: number;
  /** Absolute origin from APP_URL, for building share links without `window`. */
  shareBaseUrl: string;
  members: Array<{ id: string; email: string; acceptedAt: string | null }>;
  budget: React.ComponentProps<typeof BudgetPanel>['initialSummary'];
}

const PATCH_DEBOUNCE_MS = 400;

/**
 * Module scope so the identity is stable across renders.
 *
 * An inline `[]` fallback would be a new array every render, re-running the
 * map's geometry effect continuously — the same mistake that kept the camera
 * re-fitting while typing.
 */
const EMPTY_SEGMENTS: readonly (readonly [number, number][])[] = [];

type Panel = 'stops' | 'budget';

/**
 * One tab.
 *
 * Real `role="tab"` semantics with `aria-selected` and `aria-controls`, plus
 * left/right arrow navigation — that is what screen readers and keyboard users
 * expect from a tablist, and a row of plain buttons does not provide it.
 */
function TabButton({
  id,
  label,
  active,
  onSelect,
  count,
  warn,
}: {
  id: Panel;
  label: string;
  active: boolean;
  onSelect: (panel: Panel) => void;
  count?: number;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          onSelect(id === 'stops' ? 'budget' : 'stops');
        }
      }}
      className={`relative -mb-px rounded-t-control border-x border-t px-3.5 py-2 text-[13px] font-medium transition-colors ${
        active
          ? 'border-line bg-surface text-ink'
          : 'border-transparent text-ink-muted hover:bg-inset hover:text-ink'
      }`}
    >
      {label}
      {count !== undefined ? (
        <span className="tnum ml-1.5 text-ink-faint">{count}</span>
      ) : null}
      {warn ? (
        <span
          aria-label="Over budget"
          title="This trip is over budget"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger"
        />
      ) : null}
    </button>
  );
}

/** Inline so the page carries no icon dependency. */
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 3l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21l1.5-1.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function TripEditor({
  trip: initialTrip,
  initialStops,
  initialSummary,
  claimed,
  softCap,
  shareBaseUrl,
  members,
  budget,
}: Props) {
  const [trip, setTrip] = useState(initialTrip);
  const [stops, setStops] = useState<StopDto[]>(initialStops);
  const [summary, setSummary] = useState<SummaryDto | null>(initialSummary);
  const [recomputing, setRecomputing] = useState(false);
  const [unit, setUnit] = useState<'km' | 'mi'>('km');
  /**
   * The share dialog opens either from the button or from `?share=1` in the URL —
   * used by the magic-link return and by the sidebar's Share menu item.
   *
   * Derived from the URL rather than seeded into state: `useState(initialValue)`
   * only reads its argument on mount, so when the sidebar pushed `?share=1`
   * while already on this page the dialog never appeared.
   */
  const [shareOpenLocal, setShareOpenLocal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<StopDto | null>(null);
  /** The last marker move, offered for undo until dismissed or superseded. */
  const [lastMove, setLastMove] = useState<{
    stopId: string;
    name: string;
    from: { lat: number; lng: number };
  } | null>(null);
  /** Which panel is showing. Local state: it is a view choice, not data. */
  const [panel, setPanel] = useState<Panel>('stops');
  /** Title editing is draft-while-focused; see the input below. */
  const [titleFocused, setTitleFocused] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialTrip.title);
  const paneWidth = usePaneWidth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const shareFromUrl = searchParams.get('share') === '1';
  const shareOpen = shareOpenLocal || shareFromUrl;

  function closeShare() {
    setShareOpenLocal(false);
    // Drop the query param, or the dialog would reopen on the next render.
    if (shareFromUrl) router.replace(`/trips/${trip.id}`);
  }

  const summaryRequest = useRef(0);
  const patchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  /**
   * Recomputes legs and totals. Guarded by a request id so a slow earlier
   * response cannot overwrite a newer one.
   */
  const refreshSummary = useCallback(async () => {
    const id = ++summaryRequest.current;
    setRecomputing(true);
    try {
      const next = await api.routeSummary(trip.id);
      if (id === summaryRequest.current) setSummary(next);
    } catch (err) {
      if (id === summaryRequest.current) {
        setNotice(
          err instanceof ApiError && err.isRateLimited
            ? 'Recalculating too often — figures will catch up shortly.'
            : err instanceof ApiError && err.code === 'UPSTREAM_ERROR'
              ? err.message
              : 'Could not recalculate distances.',
        );
      }
    } finally {
      if (id === summaryRequest.current) setRecomputing(false);
    }
  }, [trip.id]);

  // No mount effect: the initial summary arrives from the server. Recomputes
  // happen only in response to a user action that actually changes the route.

  // Flush any pending debounced patches if the component unmounts.
  useEffect(
    () => () => {
      patchTimers.current.forEach((timer) => clearTimeout(timer));
      patchTimers.current.clear();
    },
    [],
  );

  async function addStop(hit: GeocodeHit) {
    try {
      const result = await api.addStop(trip.id, {
        name: hit.name,
        address: hit.address,
        lat: hit.lat,
        lng: hit.lng,
      });
      setStops((current) => [...current, result.stop]);
      if (result.overSoftCap) {
        setNotice(
          `That is over ${result.softCap} stops. It still works, but the map and route may get slow.`,
        );
      }
      void refreshSummary();
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === 'TOO_MANY_STOPS'
          ? err.message
          : 'Could not add that stop.',
      );
    }
  }

  /**
   * Optimistic local edit plus a debounced PATCH, so typing a note never waits
   * on the network but is still written to the server rather than held in the
   * browser.
   */
  function patchStop(
    stopId: string,
    patch: { name?: string; notes?: string | null; days?: number },
  ) {
    setStops((current) =>
      current.map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
    );

    const existing = patchTimers.current.get(stopId);
    if (existing) clearTimeout(existing);

    patchTimers.current.set(
      stopId,
      setTimeout(async () => {
        patchTimers.current.delete(stopId);
        try {
          await api.patchStop(trip.id, stopId, patch);
          // Only `days` changes the totals; notes and names do not.
          if (patch.days !== undefined) void refreshSummary();
        } catch {
          setNotice('Could not save that change. Check your connection.');
        }
      }, PATCH_DEBOUNCE_MS),
    );
  }

  /**
   * Repositioning a stop by dragging its map marker.
   *
   * The name and address are left alone deliberately: the name is the label you
   * chose, and silently rewriting it after a 50 m nudge would be worse than a
   * slightly stale address line. The coordinates shown on the stop card are the
   * source of truth for where the stop actually is.
   */
  async function moveStop(stopId: string, lat: number, lng: number) {
    const previous = stops;
    const before = previous.find((stop) => stop.id === stopId);
    setStops((current) =>
      current.map((stop) => (stop.id === stopId ? { ...stop, lat, lng } : stop)),
    );
    try {
      await api.patchStop(trip.id, stopId, { lat, lng });
      // Offer to put it back. Coordinates are easy to nudge and hard to retype
      // from memory, so the previous position is worth keeping around.
      if (before) {
        setLastMove({
          stopId,
          name: before.name,
          from: { lat: before.lat, lng: before.lng },
        });
      }
      // Moving a stop changes up to two legs; the cache handles the rest.
      void refreshSummary();
    } catch (err) {
      setStops(previous);
      setNotice(
        err instanceof ApiError && err.isRateLimited
          ? 'Moving stops too fast — please slow down.'
          : 'Could not move that stop.',
      );
    }
  }

  /** Puts a dragged stop back where it was. */
  async function undoMove() {
    const move = lastMove;
    if (!move) return;
    setLastMove(null);

    const previous = stops;
    setStops((current) =>
      current.map((stop) =>
        stop.id === move.stopId
          ? { ...stop, lat: move.from.lat, lng: move.from.lng }
          : stop,
      ),
    );
    try {
      await api.patchStop(trip.id, move.stopId, {
        lat: move.from.lat,
        lng: move.from.lng,
      });
      void refreshSummary();
    } catch {
      setStops(previous);
      setNotice('Could not undo that move.');
    }
  }

  /**
   * Adds a stop where the map was right-clicked.
   *
   * A name is looked up if the geocoder can provide one; otherwise the
   * coordinates are the name, which is a perfectly good label for a lay-by or a
   * trailhead that OSM has never heard of.
   */
  async function addStopAt(lat: number, lng: number) {
    let name = formatCoordinates(lat, lng);
    let address: string | null = formatCoordinates(lat, lng);
    try {
      const { result } = await api.reverseGeocode(lat, lng);
      if (result?.name) {
        name = result.name;
        address = result.address ?? formatCoordinates(lat, lng);
      }
    } catch {
      // Non-fatal: keep the coordinates as the name.
    }

    try {
      const result = await api.addStop(trip.id, { name, address, lat, lng });
      setStops((current) => [...current, result.stop]);
      if (result.overSoftCap) {
        setNotice(
          `That is over ${result.softCap} stops. It still works, but the map and route may get slow.`,
        );
      }
      void refreshSummary();
    } catch (err) {
      setNotice(
        err instanceof ApiError && err.code === 'TOO_MANY_STOPS'
          ? err.message
          : 'Could not add a stop there.',
      );
    }
  }

  async function changeProfile(stopId: string, profile: TravelProfile) {
    const previous = stops;
    setStops((current) =>
      current.map((stop) =>
        stop.id === stopId ? { ...stop, profileToNext: profile } : stop,
      ),
    );
    try {
      await api.patchStop(trip.id, stopId, { profileToNext: profile });
      void refreshSummary();
    } catch {
      setStops(previous);
      setNotice('Could not change the travel mode.');
    }
  }

  /**
   * Removal is staged so it can be confirmed by name. Previously the Remove
   * button deleted the stop — and its notes — immediately, with no undo.
   */
  async function confirmRemoveStop() {
    const target = pendingRemove;
    if (!target) return;

    const previous = stops;
    setPendingRemove(null);
    setStops((current) => current.filter((stop) => stop.id !== target.id));
    try {
      await api.deleteStop(trip.id, target.id);
      void refreshSummary();
    } catch {
      setStops(previous);
      setNotice('Could not remove that stop.');
    }
  }

  /** Optimistic reorder, rolled back if the server rejects the ordering. */
  async function reorder(orderedIds: string[]) {
    const previous = stops;
    const byId = new Map(previous.map((stop) => [stop.id, stop]));
    const next = orderedIds
      .map((id, index) => {
        const stop = byId.get(id);
        return stop ? { ...stop, position: index } : null;
      })
      .filter((stop): stop is StopDto => stop !== null);

    setStops(next);

    try {
      const result = await api.reorder(trip.id, orderedIds);
      setStops(result.stops);
      void refreshSummary();
    } catch (err) {
      setStops(previous);
      setNotice(
        err instanceof ApiError && err.isRateLimited
          ? 'Reordering too fast — please slow down.'
          : 'Could not save the new order.',
      );
    }
  }

  /**
   * Title saves carry the trip version for conflict detection. Because adding or
   * moving a stop also bumps the version, the client can hold a stale number
   * through no fault of the user — so a first conflict retries with the server's
   * value, and only a second one is reported.
   */
  async function saveTitle(title: string) {
    setTrip((current) => ({ ...current, title }));
    try {
      const { trip: updated } = await api.patchTrip(trip.id, {
        title,
        version: trip.version,
      });
      setTrip(updated);
      /*
       * The sidebar is rendered by a persistent server layout, which Next does
       * not re-render when you navigate between its children — that is what
       * keeps its scroll and filter state. The trade-off is that it has no idea
       * the title changed, so the rename has to ask for fresh data explicitly.
       */
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.isConflict && err.body.currentVersion !== undefined) {
        try {
          const { trip: updated } = await api.patchTrip(trip.id, {
            title,
            version: err.body.currentVersion,
          });
          setTrip(updated);
          router.refresh();
          return;
        } catch {
          /* fall through to the notice */
        }
      }
      setNotice('Could not rename the trip — it may be open in another tab.');
    }
  }

  const mapStops = useMemo(
    () => stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
    [stops],
  );

  const searchNear = stops.length > 0 ? stops[stops.length - 1] : undefined;

  return (
    /*
     * Two full-height columns: the editor scrolls on its own, the map fills the
     * right side edge to edge. The sidebar is supplied by the (app) layout, so
     * there is no page-level header link or settings button here any more.
     */
    /*
     * The pane width is passed down as a CSS variable and only applied at `lg`
     * and up, so no JavaScript media query is needed — below that the panes
     * stack and the divider is hidden.
     */
    <div
      className="flex h-full min-w-0 flex-col lg:flex-row"
      style={{ '--pane-width': `${paneWidth}px` } as React.CSSProperties}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:w-[var(--pane-width)] lg:flex-none">
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {/*
            While focused the input shows your draft; otherwise it shows the
            server's value. That is what lets a rename from the sidebar appear
            here — `useState` only reads its initial value once, so a component
            holding the title purely in state would keep showing the old name
            after an external change.
          */}
          {/*
            The title looked like plain text, so nothing suggested it could be
            edited. The wrapper supplies a hover box and a pencil hint — on the
            group rather than the input, so hovering anywhere along the title
            row reveals it.
          */}
          <div className="group relative min-w-0 flex-1">
            <input
              value={titleFocused ? titleDraft : initialTrip.title}
              onFocus={() => {
                setTitleDraft(initialTrip.title);
                setTitleFocused(true);
              }}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={(event) => {
                setTitleFocused(false);
                saveTitle(event.target.value.trim() || 'Untitled trip');
              }}
              title="Click to rename this trip"
              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 pr-16 text-xl font-semibold outline-none transition-colors group-hover:border-line group-hover:bg-inset focus:border-accent focus:bg-transparent"
              aria-label="Trip title"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1 text-xs text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-0"
            >
              <PencilIcon />
              Edit
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShareOpenLocal(true)}
            title={trip.shareSlug ? 'Share link' : 'Share this trip'}
            aria-label={trip.shareSlug ? 'Share link' : 'Share this trip'}
            className="relative shrink-0 rounded-control border border-line p-2 hover:bg-inset"
          >
            <LinkIcon />
            {/*
              A dot rather than a second colour: it marks "a link already
              exists" without turning the control into a status badge.
            */}
            {trip.shareSlug ? (
              <span
                aria-hidden
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
              />
            ) : null}
          </button>
        </header>

        {/*
          Pinned above the tabs: trip-level context that applies to whichever
          panel is open, so it must not scroll away with the stop list.
        */}
        <div className="flex shrink-0 flex-col gap-3 px-4 pt-4">
          <ClaimBanner claimed={claimed} tripId={trip.id} />

          <TotalsBar
            summary={summary}
            unit={unit}
            stale={recomputing}
            onToggleUnit={() => setUnit((u) => (u === 'km' ? 'mi' : 'km'))}
          />

          {notice ? (
              <div className="flex items-start justify-between gap-3 rounded-control border border-warn-line bg-warn-soft px-3 py-2 text-xs text-ink">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            ) : null}

            {lastMove ? (
              <div className="flex items-center justify-between gap-3 rounded-control border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-ink">
                <span>
                  Moved <strong>{lastMove.name}</strong> to a new position.
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={undoMove}
                    className="rounded bg-accent px-2 py-1 font-medium text-accent-ink hover:bg-accent-hover"
                  >
                    Undo move
                  </button>
                  <button
                    type="button"
                    onClick={() => setLastMove(null)}
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </span>
              </div>
            ) : null}

          {/*
            Tabs rather than a collapsible section.

            The problem was distance, not height: on a 13-stop trip the budget
            sat below every card. Collapsing it would only have made it shorter
            while leaving it just as far away. Tabs make it one click at any
            trip length — and budget is a different task from ordering stops,
            not a detail of it.
          */}
          <div role="tablist" aria-label="Trip panels" className="-mb-px flex gap-1">
            <TabButton
              id="stops"
              label="Stops"
              count={stops.length || undefined}
              active={panel === 'stops'}
              onSelect={setPanel}
            />
            <TabButton
              id="budget"
              label="Budget"
              active={panel === 'budget'}
              onSelect={setPanel}
              // A dot only when it means something: the trip is over budget.
              warn={
                budget.remainingCents !== null && budget.remainingCents < 0
              }
            />
          </div>
        </div>

        {/* Only this region scrolls, so the map and the totals never move. */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line p-4">
          <div
            role="tabpanel"
            id="panel-stops"
            aria-labelledby="tab-stops"
            hidden={panel !== 'stops'}
            className="flex flex-col gap-3"
          >
            <StopSearch onPick={addStop} near={searchNear} />

            {stops.length === 0 ? (
              <div className="rounded-card border border-dashed border-line">
                <EmptyState
                  icon={
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
                      <circle cx="12" cy="10" r="2.4" />
                    </svg>
                  }
                  title="No stops yet"
                  body="Search for a place above, paste coordinates, or right-click anywhere on the map. There is no cap on how many stops you can add."
                />
              </div>
            ) : (
              <StopList
                stops={stops}
                legs={summary?.legs ?? []}
                tripDefaultProfile={trip.defaultProfile}
                unit={unit}
                stale={recomputing}
                onReorder={reorder}
                onPatch={patchStop}
                onRemove={(stopId) =>
                  setPendingRemove(stops.find((s) => s.id === stopId) ?? null)
                }
                onProfileChange={changeProfile}
              />
            )}

            {stops.length > softCap ? (
              <p className="text-xs text-ink">
                {stops.length} stops — past {softCap} the map and recalculation get
                slower.
              </p>
            ) : null}
          </div>

          {/*
            `hidden` rather than unmounting, so switching tabs keeps the budget
            form's half-typed values and the stop list's scroll position. It also
            means dnd-kit is never torn down and rebuilt by a tab change.
          */}
          <div
            role="tabpanel"
            id="panel-budget"
            aria-labelledby="tab-budget"
            hidden={panel !== 'budget'}
          >
            <BudgetPanel
              tripId={trip.id}
              claimed={claimed}
              initialMembers={members}
              initialSummary={budget}
            />
          </div>
        </div>
      </div>

      {/* Resizable seam. Hidden when the panes are stacked. */}
      <div className="hidden lg:flex">
        <DragDivider
          width={paneWidth}
          min={PANE_MIN}
          max={PANE_MAX}
          onChange={setPaneWidth}
          label="Resize stop list"
        />
      </div>

      {/* Map takes all remaining width, full height. */}
      <div className="h-[24rem] shrink-0 border-t border-line lg:h-full lg:min-w-0 lg:flex-1 lg:border-t-0">
        <TripMap
          stops={mapStops}
          roadSegments={summary?.roadSegments ?? EMPTY_SEGMENTS}
          flightSegments={summary?.flightSegments ?? EMPTY_SEGMENTS}
          onStopMoved={moveStop}
          onAddStopAt={addStopAt}
          onRequestDeleteStop={(stopId) =>
            setPendingRemove(stops.find((s) => s.id === stopId) ?? null)
          }
          className="h-full w-full"
        />
      </div>

      {pendingRemove ? (
        <ConfirmDialog
          title={`Delete “${pendingRemove.name}”?`}
          message={
            pendingRemove.notes
              ? "This can't be undone, and its notes will be deleted too."
              : "This can't be undone."
          }
          confirmLabel="Delete stop"
          onConfirm={confirmRemoveStop}
          onCancel={() => setPendingRemove(null)}
        />
      ) : null}

      {shareOpen ? (
        <ShareDialog
          tripId={trip.id}
          initialSlug={trip.shareSlug}
          shareBaseUrl={shareBaseUrl}
          onClose={closeShare}
          onSlugChange={(slug) => setTrip((current) => ({ ...current, shareSlug: slug }))}
        />
      ) : null}
    </div>
  );
}
