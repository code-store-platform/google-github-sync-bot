import { Data } from 'effect';

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
