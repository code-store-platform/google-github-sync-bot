'use client';

import { useState, useMemo, useRef } from 'react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import type { TeamListItem } from '@/lib/types';

interface TeamAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  teams: TeamListItem[];
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
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTeams = useMemo(() => {
    const q = value.toLowerCase().trim();
    return teams.filter((t) => {
      if (existingTeams.has(t.slug)) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q);
    });
  }, [teams, existingTeams, value]);

  return (
    <Command shouldFilter={false} className="h-auto flex-1 overflow-visible bg-transparent">
      <Popover open={open && filteredTeams.length > 0} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <CommandInput
            ref={inputRef}
            value={value}
            onValueChange={onChange}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder={placeholder}
          />
        </PopoverAnchor>
        <PopoverContent className="p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <CommandList>
            <CommandEmpty>No matching teams.</CommandEmpty>
            <CommandGroup>
              {filteredTeams.map((team) => (
                <CommandItem
                  key={team.id}
                  value={team.slug}
                  onSelect={(val) => {
                    onChange(val);
                    setOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{team.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{team.slug}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
