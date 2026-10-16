import type { RepoTeamPermission } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const permissionConfig: Record<
  RepoTeamPermission,
  { label: string; variant: 'destructive' | 'success' | 'info' | 'warning' | 'secondary' }
> = {
  admin: { label: 'Admin', variant: 'destructive' },
  maintain: { label: 'Maintain', variant: 'success' },
  push: { label: 'Push', variant: 'info' },
  triage: { label: 'Triage', variant: 'warning' },
  pull: { label: 'Pull', variant: 'secondary' },
};

export function PermissionBadge({ permission }: { permission: string }) {
  const config = Object.hasOwn(permissionConfig, permission)
    ? permissionConfig[permission as RepoTeamPermission]
    : { label: permission, variant: 'secondary' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
