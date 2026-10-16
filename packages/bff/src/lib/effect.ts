import { auditLog } from '@google-github-sync/shared/db/schema';
import { NotFoundError, UpstreamError } from '@google-github-sync/shared/api';
import { Effect } from 'effect';
import { db } from '../db';

function toApiError(e: unknown): NotFoundError | UpstreamError {
  const message = e instanceof Error ? e.message : String(e);
  // Octokit / Gaxios errors carry the upstream HTTP status
  const status = typeof e === 'object' && e !== null && 'status' in e ? e.status : undefined;
  return status === 404 ? new NotFoundError({ message }) : new UpstreamError({ message });
}

// Wraps a GitHub / Google API call
export const upstream = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: toApiError }).pipe(
    Effect.tapError((e) => Effect.logError(`Upstream API error: ${e.message}`)),
  );

// Database failures are unexpected, so they surface as 500s
export const dbQuery = <A>(run: () => PromiseLike<A>) =>
  Effect.orDie(Effect.tryPromise(() => run()));

export const recordAudit = (entry: typeof auditLog.$inferInsert) =>
  dbQuery(() => db.insert(auditLog).values(entry));
