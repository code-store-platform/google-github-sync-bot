export type UserStatus = 'member' | 'pending_invite' | 'not_linked' | 'linked_not_in_org';

export type UserListItem = {
  email: string;
  name: string | null;
  githubUsername: string | null;
  status: UserStatus;
  avatarUrl: string | null;
  suspended: boolean;
};

export type UserDetail = {
  email: string;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  githubUsername: string | null;
  status: UserStatus;
  avatarUrl: string | null;
  suspended: boolean;
};

export type SyncHistoryEntry = {
  id: number;
  syncType: string;
  startedAt: string;
  completedAt: string | null;
  invitedCount: number;
  removedCount: number;
  errorCount: number;
  details: unknown;
  triggeredBy: string;
};

export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type SyncJob = {
  id: string;
  type: string;
  status: SyncJobStatus;
  triggeredBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: unknown;
};

// ── Teams ────────────────────────────────────────────────────────────────────

export type TeamPrivacy = 'closed' | 'secret';
export type TeamMemberRole = 'member' | 'maintainer';

export type TeamListItem = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  privacy: TeamPrivacy;
  membersCount: number;
  reposCount: number;
  htmlUrl: string;
};

export type TeamDetail = TeamListItem & {
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  login: string;
  id: number;
  avatarUrl: string;
  role: TeamMemberRole;
  htmlUrl: string;
};

// ── Repos ───────────────────────────────────────────────────────────────────

export type RepoVisibility = 'public' | 'private';
export type RepoTeamPermission = 'pull' | 'triage' | 'push' | 'maintain' | 'admin';

export type RepoListItem = {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  visibility: RepoVisibility;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  updatedAt: string;
  htmlUrl: string;
  archived: boolean;
};

export type RepoDetail = RepoListItem & {
  defaultBranch: string;
  homepage: string | null;
  topics: string[];
  createdAt: string;
  license: string | null;
};

export type RepoTeam = {
  id: number;
  slug: string;
  name: string;
  permission: RepoTeamPermission;
  htmlUrl: string;
};
