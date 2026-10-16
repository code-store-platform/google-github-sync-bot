import { Schema } from 'effect';

export const Success = Schema.Struct({ success: Schema.Boolean });

// ── Users ────────────────────────────────────────────────────────────────────

export const UserStatus = Schema.Literals([
  'member',
  'pending_invite',
  'not_linked',
  'linked_not_in_org',
]);
export type UserStatus = typeof UserStatus.Type;

export const UserListItem = Schema.Struct({
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  githubUsername: Schema.NullOr(Schema.String),
  status: UserStatus,
  avatarUrl: Schema.NullOr(Schema.String),
  suspended: Schema.Boolean,
});
export type UserListItem = typeof UserListItem.Type;

export const UserDetail = Schema.Struct({
  ...UserListItem.fields,
  givenName: Schema.NullOr(Schema.String),
  familyName: Schema.NullOr(Schema.String),
});
export type UserDetail = typeof UserDetail.Type;

// ── Teams ────────────────────────────────────────────────────────────────────

export const TeamPrivacy = Schema.Literals(['closed', 'secret']);
export type TeamPrivacy = typeof TeamPrivacy.Type;

export const TeamMemberRole = Schema.Literals(['member', 'maintainer']);
export type TeamMemberRole = typeof TeamMemberRole.Type;

export const TeamListItem = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  privacy: TeamPrivacy,
  membersCount: Schema.Number,
  reposCount: Schema.Number,
  htmlUrl: Schema.String,
});
export type TeamListItem = typeof TeamListItem.Type;

export const TeamDetail = Schema.Struct({
  ...TeamListItem.fields,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TeamDetail = typeof TeamDetail.Type;

export const TeamMember = Schema.Struct({
  login: Schema.String,
  id: Schema.Number,
  avatarUrl: Schema.String,
  role: TeamMemberRole,
  htmlUrl: Schema.String,
});
export type TeamMember = typeof TeamMember.Type;

export const UserTeamMembership = Schema.Struct({
  ...TeamListItem.fields,
  role: TeamMemberRole,
});
export type UserTeamMembership = typeof UserTeamMembership.Type;

// ── Repos ────────────────────────────────────────────────────────────────────

export const RepoVisibility = Schema.Literals(['public', 'private', 'internal']);
export type RepoVisibility = typeof RepoVisibility.Type;

export const RepoWriteVisibility = Schema.Literals(['public', 'private']);
export type RepoWriteVisibility = typeof RepoWriteVisibility.Type;

export const RepoPermission = Schema.Literals(['pull', 'triage', 'push', 'maintain', 'admin']);
export type RepoPermission = typeof RepoPermission.Type;

// Upstream responses may contain organization-defined repository role names.
export const RepoRole = Schema.String;
export type RepoRole = typeof RepoRole.Type;

export const RepoListItem = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  fullName: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: RepoVisibility,
  language: Schema.NullOr(Schema.String),
  stargazersCount: Schema.Number,
  forksCount: Schema.Number,
  openIssuesCount: Schema.Number,
  updatedAt: Schema.String,
  htmlUrl: Schema.String,
  archived: Schema.Boolean,
});
export type RepoListItem = typeof RepoListItem.Type;

export const RepoDetail = Schema.Struct({
  ...RepoListItem.fields,
  defaultBranch: Schema.String,
  homepage: Schema.NullOr(Schema.String),
  topics: Schema.Array(Schema.String),
  createdAt: Schema.String,
  license: Schema.NullOr(Schema.String),
});
export type RepoDetail = typeof RepoDetail.Type;

export const RepoTeam = Schema.Struct({
  id: Schema.Number,
  slug: Schema.String,
  name: Schema.String,
  permission: RepoRole,
  htmlUrl: Schema.String,
});
export type RepoTeam = typeof RepoTeam.Type;

export const CollaboratorRepo = Schema.Struct({
  name: Schema.String,
  fullName: Schema.String,
  description: Schema.NullOr(Schema.String),
  visibility: RepoVisibility,
  htmlUrl: Schema.String,
  archived: Schema.Boolean,
  permission: RepoRole,
});
export type CollaboratorRepo = typeof CollaboratorRepo.Type;

export const TeamRepoAccess = Schema.Struct({
  ...CollaboratorRepo.fields,
  teamSlug: Schema.String,
  teamName: Schema.String,
});
export type TeamRepoAccess = typeof TeamRepoAccess.Type;

export const UserRepos = Schema.Struct({
  direct: Schema.Array(CollaboratorRepo),
  teams: Schema.Array(TeamRepoAccess),
});
export type UserRepos = typeof UserRepos.Type;

// ── Sync ─────────────────────────────────────────────────────────────────────

export const SyncJobStatus = Schema.Literals(['pending', 'running', 'completed', 'failed']);
export type SyncJobStatus = typeof SyncJobStatus.Type;

export const SyncJob = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  status: SyncJobStatus,
  triggeredBy: Schema.String,
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  result: Schema.Unknown,
});
export type SyncJob = typeof SyncJob.Type;

export const SyncJobRef = Schema.Struct({ id: Schema.String, status: SyncJobStatus });
export type SyncJobRef = typeof SyncJobRef.Type;

// ── Activity ─────────────────────────────────────────────────────────────────

export const ActivityType = Schema.Literals(['sync', 'action']);
export type ActivityType = typeof ActivityType.Type;

export const ActivityEntry = Schema.Struct({
  id: Schema.String,
  type: ActivityType,
  timestamp: Schema.String,
  trigger: Schema.String,
  summary: Schema.String,
  details: Schema.Unknown,
});
export type ActivityEntry = typeof ActivityEntry.Type;

export const ActivityPage = Schema.Struct({
  items: Schema.Array(ActivityEntry),
  page: Schema.Number,
  limit: Schema.Number,
  totalCount: Schema.Number,
});
export type ActivityPage = typeof ActivityPage.Type;
