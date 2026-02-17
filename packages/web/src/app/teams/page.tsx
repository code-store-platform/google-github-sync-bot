import { Header } from '@/components/layout/header';
import { TeamTable } from '@/components/teams/team-table';

export default function TeamsPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Teams"
        description="Manage GitHub organization teams, members, and permissions."
      />
      <TeamTable />
    </div>
  );
}
