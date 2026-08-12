/**
 * Serialising throttle for upstream services that ask for a courtesy rate.
 *
 * Both the OSRM demo servers and Photon ask for at most ~1 request/second. That
 * is a *shared* ceiling on the service, not a per-user allowance, so it cannot
 * be expressed with the per-session/per-IP limiter in lib/rate-limit.ts — that
 * one exists to stop a user abusing *us*.
 *
 * ⚠️ Scope limitation, stated plainly: this is a module-level promise chain, so
 * it paces requests within a single Node process. On a multi-instance
 * deployment (Vercel spins up many Lambdas) each instance keeps its own chain,
 * and the effective upstream rate is the per-instance rate times the number of
 * warm instances. That is acceptable here because the per-leg cache makes
 * upstream calls rare and small — a 60-stop trip is one or two requests, and a
 * reopened trip is zero — but it is not a hard global guarantee. Getting one
 * would need a shared leased token (Postgres or Redis), which is the right move
 * if this ever leaves the demo servers behind.
 */

export interface Throttle {
  /** Runs `task` no sooner than `minIntervalMs` after the previous one. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createThrottle(minIntervalMs: number): Throttle {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStartedAt = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const wait = lastStartedAt + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        lastStartedAt = Date.now();
        return task();
      });

      // Keep the chain going even when a task rejects, so one failure does not
      // wedge every later request.
      tail = result.then(
        () => undefined,
        () => undefined,
      );

      return result;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
