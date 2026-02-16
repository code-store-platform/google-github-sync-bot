import { Header } from '@/components/layout/header';
import { UserTable } from '@/components/users/user-table';

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <Header
        title="Users"
        description="Manage Google Workspace users and their GitHub organization membership."
      />
      <UserTable />
    </div>
  );
}
