'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';
import Image from 'next/image';
import { api } from '@/lib/api-client';
import type { UserListItem, UserStatus } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from './status-badge';

type SortField = 'name' | 'email' | 'status';
type SortDir = 'asc' | 'desc';

const statusFilters: { value: UserStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'member', label: 'Member' },
  { value: 'pending_invite', label: 'Pending' },
  { value: 'not_linked', label: 'Not Linked' },
  { value: 'linked_not_in_org', label: 'Not in Org' },
];

export function UserTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const {
    data: users,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    if (!users) return [];

    let result = users;

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.name?.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.githubUsername?.toLowerCase().includes(q),
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((u) => u.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '');
      } else if (sortField === 'email') {
        cmp = a.email.localeCompare(b.email);
      } else if (sortField === 'status') {
        cmp = a.status.localeCompare(b.status);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [users, search, statusFilter, sortField, sortDir]);

  if (isLoading) {
    return <UserTableSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-destructive font-medium">Failed to load users</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or GitHub username..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {statusFilters.map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-3 text-left text-sm font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('name')}
                >
                  User <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="p-3 text-left text-sm font-medium hidden sm:table-cell">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('email')}
                >
                  Email <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="p-3 text-left text-sm font-medium">GitHub</th>
              <th className="p-3 text-left text-sm font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('status')}
                >
                  Status <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  {search || statusFilter !== 'all'
                    ? 'No users match your filters'
                    : 'No users found'}
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <UserRow
                  key={user.email}
                  user={user}
                  onClick={() => router.push(`/users/${encodeURIComponent(user.email)}`)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {users?.length || 0} users
      </p>
    </div>
  );
}

function UserRow({ user, onClick }: { user: UserListItem; onClick: () => void }) {
  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="p-3">
        <div className="flex items-center gap-3">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
              {(user.name || user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p className="font-medium text-sm">{user.name || user.email}</p>
            <p className="text-xs text-muted-foreground sm:hidden">{user.email}</p>
          </div>
          {user.suspended && (
            <Badge variant="destructive" className="text-xs">
              Suspended
            </Badge>
          )}
        </div>
      </td>
      <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">{user.email}</td>
      <td className="p-3 text-sm">
        {user.githubUsername ? (
          <span className="font-mono text-xs">{user.githubUsername}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3">
        <StatusBadge status={user.status} />
      </td>
    </tr>
  );
}

function UserTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm" />
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-20" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="border-b bg-muted/50 p-3">
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b p-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
