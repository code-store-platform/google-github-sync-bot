import { Badge } from '@/components/ui/badge';
import type { UserStatus } from '@/lib/types';

const statusConfig: Record<
  UserStatus,
  { label: string; variant: 'success' | 'warning' | 'info' | 'secondary' }
> = {
  member: { label: 'Member', variant: 'success' },
  pending_invite: { label: 'Pending', variant: 'warning' },
  not_linked: { label: 'Not Linked', variant: 'secondary' },
  linked_not_in_org: { label: 'Not in Org', variant: 'info' },
};

export function StatusBadge({ status }: { status: UserStatus }) {
  const config = statusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
