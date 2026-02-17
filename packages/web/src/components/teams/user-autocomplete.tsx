'use client';

import { useState, useMemo, useRef } from 'react';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import type { UserListItem } from '@/lib/types';

interface UserAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  workspaceUsers: UserListItem[];
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
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    <Command shouldFilter={false} className="h-auto flex-1 overflow-visible bg-transparent">
      <Popover open={open && filteredUsers.length > 0} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <CommandInput
            ref={inputRef}
            value={value}
            onValueChange={onChange}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setOpen(false), 150);
            }}
            placeholder={placeholder}
          />
        </PopoverAnchor>
        <PopoverContent
          className="p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <CommandList>
            <CommandEmpty>No matching users. Type any GitHub username.</CommandEmpty>
            <CommandGroup>
              {filteredUsers.map((user) => (
                <CommandItem
                  key={user.email}
                  value={user.githubUsername!}
                  onSelect={(val) => {
                    onChange(val);
                    setOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {user.name || user.email}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {user.githubUsername}
                    </span>
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
