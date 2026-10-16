'use client';

import { useMemo } from 'react';
import { Autocomplete } from '@/components/ui/autocomplete';
import type { RepoListItem } from '@/lib/types';

interface RepoAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  repos: readonly RepoListItem[];
  existingRepoNames: Set<string>;
  placeholder?: string;
}

export function RepoAutocomplete({
  value,
  onChange,
  repos,
  existingRepoNames,
  placeholder = 'Search repos...',
}: RepoAutocompleteProps) {
  const filteredRepos = useMemo(() => {
    const q = value.toLowerCase().trim();
    return repos.filter((r) => {
      if (existingRepoNames.has(r.name)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) || (r.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [repos, existingRepoNames, value]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyMessage="No matching repos."
      options={filteredRepos.map((repo) => ({
        key: repo.name,
        value: repo.name,
        label: (
          <div className="flex flex-col">
            <span className="text-sm font-medium font-mono">{repo.name}</span>
            {repo.description && (
              <span className="text-xs text-muted-foreground truncate">{repo.description}</span>
            )}
          </div>
        ),
      }))}
    />
  );
}
