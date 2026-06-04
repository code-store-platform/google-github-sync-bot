'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { Search, ArrowUpDown, Star, GitFork } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import type { RepoListItem } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { VisibilityBadge } from './visibility-badge';
import { LanguageBadge } from './language-badge';

type SortField = 'name' | 'stargazersCount' | 'updatedAt';
type SortDir = 'asc' | 'desc';

export function RepoTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const {
    data: repos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repos'],
    queryFn: api.getRepos,
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };

  const filtered = useMemo(() => {
    if (!repos) return [];

    let result = repos;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q),
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'stargazersCount') {
        cmp = a.stargazersCount - b.stargazersCount;
      } else if (sortField === 'updatedAt') {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [repos, search, sortField, sortDir]);

  if (isLoading) {
    return <RepoTableSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-destructive font-medium">Failed to load repositories</p>
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
                  Repository <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="p-3 text-left text-sm font-medium hidden md:table-cell">
                Description
              </th>
              <th className="p-3 text-left text-sm font-medium">Visibility</th>
              <th className="p-3 text-left text-sm font-medium hidden sm:table-cell">Language</th>
              <th className="p-3 text-left text-sm font-medium">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('stargazersCount')}
                >
                  <Star className="h-3 w-3" /> <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="p-3 text-left text-sm font-medium hidden lg:table-cell">
                <GitFork className="h-3 w-3" />
              </th>
              <th className="p-3 text-left text-sm font-medium hidden lg:table-cell">
                <button
                  type="button"
                  className="flex items-center gap-1"
                  onClick={() => toggleSort('updatedAt')}
                >
                  Updated <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  {search ? 'No repositories match your search' : 'No repositories found'}
                </td>
              </tr>
            ) : (
              filtered.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  onClick={() => router.push(`/repos/${repo.name}`)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {repos?.length || 0} repositories
      </p>
    </div>
  );
}

function RepoRow({ repo, onClick }: { repo: RepoListItem; onClick: () => void }) {
  return (
    <tr
      className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors ${repo.archived ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <td className="p-3">
        <p className="font-medium text-sm">
          {repo.name}
          {repo.archived && (
            <span className="text-xs text-muted-foreground ml-1.5">(archived)</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground md:hidden truncate max-w-[200px]">
          {repo.description || '-'}
        </p>
      </td>
      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
        <span className="truncate block max-w-[300px]">{repo.description || '-'}</span>
      </td>
      <td className="p-3">
        <VisibilityBadge visibility={repo.visibility} />
      </td>
      <td className="p-3 hidden sm:table-cell">
        <LanguageBadge language={repo.language} />
      </td>
      <td className="p-3">
        <span className="text-sm text-muted-foreground">{repo.stargazersCount}</span>
      </td>
      <td className="p-3 hidden lg:table-cell">
        <span className="text-sm text-muted-foreground">{repo.forksCount}</span>
      </td>
      <td className="p-3 hidden lg:table-cell">
        <span className="text-sm text-muted-foreground">
          {formatDate(repo.updatedAt)}
        </span>
      </td>
    </tr>
  );
}

function RepoTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-sm" />
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
            <Skeleton className="h-4 w-16 hidden sm:block" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}
