import { Header } from '@/components/layout/header';
import { ActivityTimeline } from '@/components/activity/activity-timeline';

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Activity"
        description="Unified timeline of sync runs and admin actions."
      />
      <ActivityTimeline />
    </div>
  );
}
