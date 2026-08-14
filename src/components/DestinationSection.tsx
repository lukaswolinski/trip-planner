interface Props {
  title: string;
  /** One line describing what will eventually live here. */
  hint: string;
  /**
   * Set for sections that will be filled by a booking or tours partner.
   *
   * Partner results have to be visually separable from anything the user saved
   * themselves, and carry a disclosure that the links are paid. Reserving the
   * slot now means adding the integration later is a data change, not a
   * redesign — and that the disclosure cannot be forgotten, because the empty
   * state already shows it.
   */
  partnerSlot?: string;
}

/**
 * An empty section on the destination screen.
 *
 * Deliberately says it is empty rather than showing a plausible-looking
 * skeleton: a shimmering placeholder reads as "loading", and this is not
 * loading — there is nothing to load yet.
 */
export default function DestinationSection({ title, hint, partnerSlot }: Props) {
  return (
    <section className="rounded-card border border-line">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full bg-inset px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
          Coming soon
        </span>
      </div>

      <div className="px-4 py-6">
        <p className="text-sm text-ink-muted">{hint}</p>

        {partnerSlot ? (
          <div className="mt-3 rounded-control border border-dashed border-line px-3 py-3">
            <p className="text-xs text-ink-muted">{partnerSlot}</p>
            <p className="mt-1 text-[11px] text-ink-faint">
              Partner links will be marked as such, and we may earn a commission.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
