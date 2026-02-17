import type { TeamMemberRole } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const roleConfig: Record<TeamMemberRole, { label: string; variant: 'success' | 'secondary' }> = {
  maintainer: { label: 'Maintainer', variant: 'success' },
  member: { label: 'Member', variant: 'secondary' },
};

export function RoleBadge({ role }: { role: TeamMemberRole }) {
  const config = roleConfig[role];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
