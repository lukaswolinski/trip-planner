import { microLabel } from './ui';

interface Props {
  title: string;
  /** One line describing what will fill this section. */
  hint: string;
  /**
   * True for sections a booking or tours partner will supply.
   *
   * Partner results must be visually separable from anything the user saved
   * themselves and must carry a disclosure that the links are paid. Declaring
   * it now means the layout already has room for the label, and the label
   * cannot be forgotten later — the empty state shows it before any real
   * listing exists.
   */
  partner?: boolean;
  /** Shown on the placeholder cards, e.g. "from $120 / night". */
  priceHint?: string;
}

/**
 * A section shell built to the shape of a real listing.
 *
 * The placeholder cards carry the actual layout — image, title, meta line,
 * rating, price, Book button — rather than a grey box, so the design is being
 * tested against the content it will hold. If four fields plus a price and an
 * action do not fit here, that is worth discovering now rather than after an
 * integration is wired up.
 *
 * The cards are deliberately inert and labelled as examples: a placeholder that
 * looked clickable would be a lie about what the app can currently do.
 */
export default function ListingSection({ title, hint, partner, priceHint }: Props) {
  return (
    <section className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="truncate text-[13px] text-ink-muted">{hint}</p>
        </div>
        <span className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          Coming soon
        </span>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <PlaceholderCard key={index} priceHint={priceHint} />
        ))}
      </div>

      {partner ? (
        <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
          Results here will come from booking partners. Paid links will be marked
          as such, and we may earn a commission.
        </p>
      ) : null}
    </section>
  );
}

function PlaceholderCard({ priceHint }: { priceHint?: string }) {
  return (
    <article
      aria-hidden
      className="overflow-hidden rounded-control border border-dashed border-line"
    >
      {/* Where the photo goes. A 16:10 well, so the row height is already real. */}
      <div className="flex aspect-[16/10] items-center justify-center bg-inset">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m21 16-5-5L5 20" />
        </svg>
      </div>

      <div className="space-y-2 p-3">
        <div className="skeleton h-3.5 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className={microLabel}>{priceHint ?? 'Price'}</span>
          <span className="rounded-control border border-line px-2.5 py-1 text-[11px] font-medium text-ink-faint">
            Book
          </span>
        </div>
      </div>
    </article>
  );
}
