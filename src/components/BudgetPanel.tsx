'use client';

import { useState } from 'react';
import { EmptyState, button, input, inputCompact, microLabel } from './ui';

interface Member {
  id: string;
  email: string;
  acceptedAt: string | null;
}

interface Summary {
  totalCents: number | null;
  currency: string;
  spentCents: number;
  remainingCents: number | null;
  expenses: Array<{
    id: string;
    description: string;
    amountCents: number;
    paidByMemberId: string | null;
    shares: Array<{ memberId: string; shareCents: number }>;
  }>;
  perMember: Array<{
    memberId: string;
    email: string;
    paidCents: number;
    owedCents: number;
  }>;
}

interface Props {
  tripId: string;
  claimed: boolean;
  initialMembers: Member[];
  initialSummary: Summary;
}

/** Cents to a plain decimal, without a locale surprise on the way. */
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parses "12.30" into 1230 cents.
 *
 * Multiplying by 100 in floating point gives 1229.9999999999998 for some
 * inputs, so the fractional part is read as digits and padded instead. Money
 * never touches a float here.
 */
export function parseMoney(value: string): number | null {
  const text = value.trim().replace(/[, ]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export default function BudgetPanel({
  tripId,
  claimed,
  initialMembers,
  initialSummary,
}: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [total, setTotal] = useState(
    initialSummary.totalCents === null ? '' : String(initialSummary.totalCents / 100),
  );
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [splitAll, setSplitAll] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const currency = summary.currency;

  async function post(body: unknown) {
    const res = await fetch(`/api/trips/${tripId}/budget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Summary;
  }

  async function saveTotal() {
    const cents = total.trim() === '' ? null : parseMoney(total);
    if (total.trim() !== '' && cents === null) {
      setNotice({ tone: 'error', text: 'Enter an amount like 1200 or 1200.50.' });
      return;
    }
    setBusy(true);
    try {
      setSummary(await post({ action: 'setTotal', totalCents: cents }));
      setNotice(null);
    } catch {
      setNotice({ tone: 'error', text: 'Could not save the budget.' });
    } finally {
      setBusy(false);
    }
  }

  async function addExpense() {
    const cents = parseMoney(amount);
    if (description.trim() === '' || cents === null || cents <= 0) {
      setNotice({ tone: 'error', text: 'Add a description and an amount above zero.' });
      return;
    }
    setBusy(true);
    try {
      setSummary(
        await post({
          action: 'addExpense',
          description: description.trim(),
          amountCents: cents,
          paidByMemberId: paidBy || null,
          splitBetween: splitAll ? members.map((m) => m.id) : [],
        }),
      );
      setDescription('');
      setAmount('');
      setNotice(null);
    } catch {
      setNotice({ tone: 'error', text: 'Could not add that expense.' });
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    const email = inviteEmail.trim();
    if (email === '') return;
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();

      if (!res.ok) {
        setNotice({
          tone: 'error',
          text:
            body.error === 'EMAIL_REQUIRED'
              ? 'Add your own email to this account before inviting others.'
              : (body.message ?? 'Could not send that invitation.'),
        });
        return;
      }

      setMembers((current) =>
        current.some((m) => m.id === body.member.id) ? current : [...current, body.member],
      );
      setInviteEmail('');

      /*
       * The invitation exists whether or not the email went out, so the
       * message says exactly that. Reporting a plain success would be a lie
       * while the sending domain is unverified — and reporting a failure would
       * wrongly suggest the person was not invited at all.
       */
      setNotice(
        body.emailSent
          ? { tone: 'ok', text: `Invitation sent to ${body.member.email}.` }
          : {
              tone: 'warn',
              text: `${body.member.email} was added, but the email could not be sent. They can still join by signing in with that address.`,
            },
      );
    } catch {
      setNotice({ tone: 'error', text: 'Could not send that invitation.' });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/members/${member.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      setMembers((current) => current.filter((m) => m.id !== member.id));
      setNotice({ tone: 'ok', text: `${member.email} no longer has access.` });
    } catch {
      setNotice({ tone: 'error', text: 'Could not remove that person.' });
    } finally {
      setBusy(false);
    }
  }

  const overspent =
    summary.remainingCents !== null && summary.remainingCents < 0;

  return (
    <section className="rounded-card border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold">Budget &amp; trip mates</h2>
      </div>

      <div className="space-y-5 p-4">
        {/* Totals */}
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <div>
            <div className={microLabel}>Budget</div>
            <div className="mt-1 flex items-center gap-1.5">
              <input
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                onBlur={saveTotal}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                placeholder="Not set"
                aria-label="Total budget"
                inputMode="decimal"
                className={`${inputCompact} tnum w-28`}
              />
              <span className="text-[11px] text-ink-faint">{currency}</span>
            </div>
          </div>
          <div>
            <div className={microLabel}>Spent</div>
            <div className="tnum mt-1 text-[15px] font-semibold">
              {money(summary.spentCents, currency)}
            </div>
          </div>
          <div>
            <div className={microLabel}>Remaining</div>
            <div
              className={`tnum mt-1 text-[15px] font-semibold ${overspent ? 'text-danger' : ''}`}
            >
              {summary.remainingCents === null
                ? '—'
                : money(summary.remainingCents, currency)}
            </div>
          </div>
        </div>

        {notice ? (
          <p
            role="status"
            className={`rounded-control border px-3 py-2 text-[13px] ${
              notice.tone === 'error'
                ? 'border-danger/30 bg-danger-soft text-danger'
                : notice.tone === 'warn'
                  ? 'border-warn-line bg-warn-soft text-ink'
                  : 'border-accent/30 bg-accent-soft text-ink'
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        {/* Add an expense */}
        <div>
          <div className={microLabel}>Add an expense</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What was it for?"
              aria-label="Expense description"
              className={`${input} min-w-0 flex-1`}
            />
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              aria-label="Amount"
              inputMode="decimal"
              className={`${inputCompact} tnum w-24`}
            />
            <select
              value={paidBy}
              onChange={(event) => setPaidBy(event.target.value)}
              aria-label="Paid by"
              className={inputCompact}
            >
              <option value="">Paid by…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.email}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
              <input
                type="checkbox"
                checked={splitAll}
                onChange={(event) => setSplitAll(event.target.checked)}
              />
              Split evenly
            </label>
            <button
              type="button"
              onClick={addExpense}
              disabled={busy}
              className={button.primary}
            >
              Add
            </button>
          </div>
        </div>

        {/* Expenses */}
        {summary.expenses.length === 0 ? (
          <EmptyState
            title="No expenses yet"
            body="Add what you spend and it will count against the budget above."
          />
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {summary.expenses.map((expense) => (
              <li key={expense.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {expense.description}
                </span>
                {expense.shares.length > 0 ? (
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    split {expense.shares.length} ways
                  </span>
                ) : null}
                <span className="tnum shrink-0 text-sm font-medium">
                  {money(expense.amountCents, currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Who owes what */}
        {summary.perMember.length > 0 && summary.spentCents > 0 ? (
          <div>
            <div className={microLabel}>Per person</div>
            <ul className="mt-2 space-y-1">
              {summary.perMember.map((row) => {
                const net = row.paidCents - row.owedCents;
                return (
                  <li
                    key={row.memberId}
                    className="flex items-center gap-3 text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate">{row.email}</span>
                    <span className="tnum shrink-0 text-ink-muted">
                      paid {money(row.paidCents, currency)}
                    </span>
                    <span className="tnum shrink-0 text-ink-muted">
                      owes {money(row.owedCents, currency)}
                    </span>
                    <span
                      className={`tnum w-24 shrink-0 text-right font-medium ${
                        net < 0 ? 'text-danger' : 'text-ink'
                      }`}
                      title={
                        net < 0
                          ? 'Owes this much to the group'
                          : 'Is owed this much by the group'
                      }
                    >
                      {net < 0 ? '−' : '+'}
                      {money(Math.abs(net), currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Trip mates */}
        <div>
          <div className={microLabel}>Trip mates</div>
          {!claimed ? (
            <p className="mt-2 rounded-control border border-warn-line bg-warn-soft px-3 py-2 text-[13px]">
              Add your email to this browser first — an invitation has to come from
              an account, and their access will be tied to theirs.
            </p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void invite();
                    }
                  }}
                  type="email"
                  placeholder="their@email.com"
                  aria-label="Invite by email"
                  className={`${input} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={invite}
                  disabled={busy || inviteEmail.trim() === ''}
                  className={button.secondary}
                >
                  Invite
                </button>
              </div>

              <ul className="mt-2 space-y-1">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{member.email}</span>
                    {member.acceptedAt ? null : (
                      <span
                        className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint"
                        title="Invited, but has not signed in yet — no access until they do"
                      >
                        Pending
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeMember(member)}
                      disabled={busy}
                      className="shrink-0 rounded px-1.5 py-0.5 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                      aria-label={`Remove ${member.email}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
