import { Header } from '@/components/layout/header';
import { RepoTable } from '@/components/repos/repo-table';

export default function ReposPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Repositories"
        description="Browse and manage GitHub organization repositories and team access."
      />
      <RepoTable />
    </div>
  );
}
