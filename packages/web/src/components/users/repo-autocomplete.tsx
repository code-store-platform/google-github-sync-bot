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
import type { RepoListItem } from '@/lib/types';

interface RepoAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  repos: RepoListItem[];
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
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredRepos = useMemo(() => {
    const q = value.toLowerCase().trim();
    return repos.filter((r) => {
      if (existingRepoNames.has(r.name)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [repos, existingRepoNames, value]);

  return (
    <Command shouldFilter={false} className="h-auto flex-1 overflow-visible bg-transparent">
      <Popover open={open && filteredRepos.length > 0} onOpenChange={setOpen}>
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
            <CommandEmpty>No matching repos.</CommandEmpty>
            <CommandGroup>
              {filteredRepos.map((repo) => (
                <CommandItem
                  key={repo.name}
                  value={repo.name}
                  onSelect={(val) => {
                    onChange(val);
                    setOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium font-mono">{repo.name}</span>
                    {repo.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {repo.description}
                      </span>
                    )}
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
