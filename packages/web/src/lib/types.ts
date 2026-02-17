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
