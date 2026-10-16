'use client';

import { useMemo } from 'react';
import { Autocomplete } from '@/components/ui/autocomplete';
import type { TeamListItem } from '@/lib/types';

interface TeamAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  teams: readonly TeamListItem[];
  existingTeams: Set<string>;
  placeholder?: string;
}

export function TeamAutocomplete({
  value,
  onChange,
  teams,
  existingTeams,
  placeholder = 'Team name or slug',
}: TeamAutocompleteProps) {
  const filteredTeams = useMemo(() => {
    const q = value.toLowerCase().trim();
    return teams.filter((t) => {
      if (existingTeams.has(t.slug)) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    });
  }, [teams, existingTeams, value]);

  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyMessage="No matching teams."
      options={filteredTeams.map((team) => ({
        key: String(team.id),
        value: team.slug,
        label: (
          <div className="flex flex-col">
            <span className="text-sm font-medium">{team.name}</span>
            <span className="text-xs text-muted-foreground font-mono">{team.slug}</span>
          </div>
        ),
      }))}
    />
  );
}
