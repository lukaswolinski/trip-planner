import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import { addExpense, budgetSummary, setBudget } from '@/lib/trips/members';

export async function GET(request: Request, ctx: RouteContext<'/api/trips/[id]/budget'>) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');
    return apiOk(await budgetSummary(guarded.db, id));
  } catch (error) {
    return serverError('GET /api/trips/[id]/budget', error);
  }
}

/** Sets the budget target, or adds an expense — whichever the body describes. */
export async function POST(request: Request, ctx: RouteContext<'/api/trips/[id]/budget'>) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.budgetAction);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    if (parsed.data.action === 'setTotal') {
      await setBudget(guarded.db, id, parsed.data.totalCents);
    } else {
      await addExpense(guarded.db, id, guarded.context.userId, {
        description: parsed.data.description,
        amountCents: parsed.data.amountCents,
        paidByMemberId: parsed.data.paidByMemberId ?? null,
        splitBetween: parsed.data.splitBetween ?? [],
      });
    }

    return apiOk(await budgetSummary(guarded.db, id));
  } catch (error) {
    return serverError('POST /api/trips/[id]/budget', error);
  }
}
