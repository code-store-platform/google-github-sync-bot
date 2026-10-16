'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './command';
import { Popover, PopoverContent, PopoverAnchor } from './popover';

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly { key: string; value: string; label: ReactNode }[];
  placeholder: string;
  emptyMessage: string;
}

// Domain components supply already filtered options; free-text input remains supported.
export function Autocomplete({
  value,
  onChange,
  options,
  placeholder,
  emptyMessage,
}: AutocompleteProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(blurTimer.current), []);

  return (
    <Command shouldFilter={false} className="h-auto flex-1 overflow-visible bg-transparent">
      <Popover open={open && options.length > 0} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <CommandInput
            ref={inputRef}
            value={value}
            onValueChange={onChange}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              setOpen(true);
            }}
            onBlur={() => {
              // Allow a suggestion click to finish before closing the list.
              clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => setOpen(false), 150);
            }}
            placeholder={placeholder}
          />
        </PopoverAnchor>
        <PopoverContent className="p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.key}
                  value={option.value}
                  onSelect={(selected) => {
                    clearTimeout(blurTimer.current);
                    onChange(selected);
                    inputRef.current?.focus();
                    setOpen(false);
                  }}
                >
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
