'use client';

import { useMemo } from 'react';
import { Autocomplete } from '@/components/ui/autocomplete';
import { PrivacyBadge } from '@/components/teams/privacy-badge';
import type { TeamListItem } from '@/lib/types';

interface TeamAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  teams: readonly TeamListItem[];
  existingTeamSlugs: Set<string>;
  placeholder?: string;
}

export function TeamAutocomplete({
  value,
  onChange,
  teams,
  existingTeamSlugs,
  placeholder = 'Search teams...',
}: TeamAutocompleteProps) {
  const filteredTeams = useMemo(() => {
    const q = value.toLowerCase().trim();
    return teams.filter((t) => {
      if (existingTeamSlugs.has(t.slug)) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [teams, existingTeamSlugs, value]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyMessage="No matching teams."
      options={filteredTeams.map((team) => ({
        key: team.slug,
        value: team.slug,
        label: (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{team.name}</span>
            <PrivacyBadge privacy={team.privacy} />
          </div>
        ),
      }))}
    />
  );
}
