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
    <section className="rounded-xl border border-black/10 dark:border-white/15">
      <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-2.5 dark:border-white/15">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wide text-black/50 dark:bg-white/10 dark:text-white/50">
          Coming soon
        </span>
      </div>

      <div className="px-4 py-6">
        <p className="text-sm text-black/45 dark:text-white/45">{hint}</p>

        {partnerSlot ? (
          <div className="mt-3 rounded-lg border border-dashed border-black/15 px-3 py-3 dark:border-white/20">
            <p className="text-xs text-black/45 dark:text-white/45">{partnerSlot}</p>
            <p className="mt-1 text-[11px] text-black/35 dark:text-white/35">
              Partner links will be marked as such, and we may earn a commission.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
