'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { Search, ArrowUpDown, Users } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { TeamListItem } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PrivacyBadge } from './privacy-badge';
import { CreateTeamDialog } from './create-team-dialog';

type SortField = 'name' | 'membersCount';
type SortDir = 'asc' | 'desc';

export function TeamTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const {
    data: teams,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['teams'],
    queryFn: api.getTeams,
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
    if (!teams) return [];

    let result = teams;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q),
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'membersCount') {
        cmp = a.membersCount - b.membersCount;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [teams, search, sortField, sortDir]);

  if (isLoading) {
    return <TeamTableSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-destructive font-medium">Failed to load teams</p>
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
            placeholder="Search by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <CreateTeamDialog />
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
                  Team <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="p-3 text-left text-sm font-medium hidden md:table-cell">
                Description
              </th>
              <th className="p-3 text-left text-sm font-medium">Privacy</th>
              <th className="p-3 text-left text-sm font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('membersCount')}
                >
                  Members <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  {search ? 'No teams match your search' : 'No teams found'}
                </td>
              </tr>
            ) : (
              filtered.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  onClick={() => router.push(`/teams/${team.slug}`)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {teams?.length || 0} teams
      </p>
    </div>
  );
}

function TeamRow({ team, onClick }: { team: TeamListItem; onClick: () => void }) {
  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="p-3">
        <p className="font-medium text-sm">{team.name}</p>
        <p className="text-xs text-muted-foreground md:hidden truncate max-w-[200px]">
          {team.description || '-'}
        </p>
      </td>
      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
        <span className="truncate block max-w-[300px]">{team.description || '-'}</span>
      </td>
      <td className="p-3">
        <PrivacyBadge privacy={team.privacy} />
      </td>
      <td className="p-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {team.membersCount}
        </div>
      </td>
    </tr>
  );
}

function TeamTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="rounded-lg border">
        <div className="border-b bg-muted/50 p-3">
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b p-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-48 hidden md:block" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
