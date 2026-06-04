import { Data } from 'effect';

export function describeError(e: unknown): string {
  if (e instanceof AggregateError) {
    const inner =
      e.errors.length > 0 ? e.errors.map(describeError).join('; ') : '<no inner errors>';
    const prefix = e.message ? `AggregateError(${e.message})` : 'AggregateError';
    return `${prefix} [${inner}]`;
  }
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    const causeStr = cause !== undefined ? ` (cause: ${describeError(cause)})` : '';
    return `${e.name}: ${e.message}${causeStr}`;
  }
  return String(e);
}

export class GoogleWorkspaceError extends Data.TaggedError('GoogleWorkspaceError')<{
  message: string;
}> {}

export class GitHubError extends Data.TaggedError('GitHubError')<{
  message: string;
}> {}

export class SlackError extends Data.TaggedError('SlackError')<{
  message: string;
}> {}

export class SyncJobError extends Data.TaggedError('SyncJobError')<{
  message: string;
}> {}

export class JobProcessorError extends Data.TaggedError('JobProcessorError')<{
  message: string;
}> {}
