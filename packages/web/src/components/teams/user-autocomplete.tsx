'use client';

import { useMemo } from 'react';
import { Autocomplete } from '@/components/ui/autocomplete';
import type { UserListItem } from '@/lib/types';

interface UserAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  workspaceUsers: readonly UserListItem[];
  existingMembers: Set<string>;
  placeholder?: string;
}

export function UserAutocomplete({
  value,
  onChange,
  workspaceUsers,
  existingMembers,
  placeholder = 'GitHub username',
}: UserAutocompleteProps) {
  const filteredUsers = useMemo(() => {
    const q = value.toLowerCase().trim();
    return workspaceUsers.filter((u) => {
      if (!u.githubUsername) return false;
      if (existingMembers.has(u.githubUsername.toLowerCase())) return false;
      if (!q) return true;
      return (
        u.githubUsername.toLowerCase().includes(q) ||
        (u.name?.toLowerCase().includes(q) ?? false) ||
        u.email.toLowerCase().includes(q)
      );
    });
  }, [workspaceUsers, existingMembers, value]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyMessage="No matching users. Type any GitHub username."
      options={filteredUsers.map((user) => ({
        key: user.email,
        value: user.githubUsername ?? '',
        label: (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user.name || user.email}</span>
            <span className="text-xs text-muted-foreground font-mono">{user.githubUsername}</span>
          </div>
        ),
      }))}
    />
  );
}
