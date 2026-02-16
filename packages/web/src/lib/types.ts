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
