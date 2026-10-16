import { Schema } from 'effect';

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  'NotFoundError',
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

// GitHub / Google API failures that aren't a plain "not found"
export class UpstreamError extends Schema.TaggedError<UpstreamError>()(
  'UpstreamError',
  { message: Schema.String },
  { httpApiStatus: 502 },
) {}

export class SyncInProgressError extends Schema.TaggedError<SyncInProgressError>()(
  'SyncInProgressError',
  { message: Schema.String, jobId: Schema.String, status: Schema.String },
  { httpApiStatus: 409 },
) {}
