/**
 * Shared Route Handler plumbing: typed error responses and body parsing.
 */

import type { ZodType } from 'zod';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'EMAIL_REQUIRED'
  | 'CONFLICT'
  | 'TOO_MANY_STOPS'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'SERVER_ERROR';

const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  EMAIL_REQUIRED: 403,
  CONFLICT: 409,
  TOO_MANY_STOPS: 422,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
  SERVER_ERROR: 500,
};

export function apiError(
  code: ApiErrorCode,
  message?: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: code, message: message ?? code, ...extra },
    { status: STATUS[code] },
  );
}

export function apiOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/**
 * Parses and validates a JSON body. Returns the failure as a ready-made 400 so
 * handlers stay a single early-return.
 */
export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError('BAD_REQUEST', 'Body must be valid JSON'),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: apiError('BAD_REQUEST', 'Validation failed', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    };
  }

  return { ok: true, data: result.data };
}

export function parseQuery<T>(url: URL, schema: ZodType<T>): ParseResult<T> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    // Numeric-looking query params are coerced so schemas can use z.number().
    const asNumber = Number(value);
    raw[key] = value !== '' && Number.isFinite(asNumber) ? asNumber : value;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: apiError('BAD_REQUEST', 'Invalid query parameters', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }),
    };
  }
  return { ok: true, data: result.data };
}

/** Logs server-side and returns an opaque 500, never leaking internals. */
export function serverError(context: string, error: unknown): Response {
  console.error(`[api] ${context}`, error);
  return apiError('SERVER_ERROR', 'Something went wrong on our end');
}
