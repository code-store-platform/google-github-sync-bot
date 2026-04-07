import type { RepoVisibility } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

const visibilityConfig: Record<RepoVisibility, { label: string; variant: 'info' | 'warning' }> = {
  public: { label: 'Public', variant: 'info' },
  private: { label: 'Private', variant: 'warning' },
};

export function VisibilityBadge({ visibility }: { visibility: RepoVisibility }) {
  const config = visibilityConfig[visibility];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
