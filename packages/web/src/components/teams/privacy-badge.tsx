import type { TeamPrivacy } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const privacyConfig: Record<TeamPrivacy, { label: string; variant: 'info' | 'warning' }> = {
  closed: { label: 'Visible', variant: 'info' },
  secret: { label: 'Secret', variant: 'warning' },
};

export function PrivacyBadge({ privacy }: { privacy: TeamPrivacy }) {
  const config = privacyConfig[privacy];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
