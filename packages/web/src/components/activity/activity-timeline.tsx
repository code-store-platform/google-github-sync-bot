'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Clock, Zap } from 'lucide-react';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';
import type { ActivityEntry, ActivityType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const typeFilters: { value: ActivityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sync', label: 'Sync' },
  { value: 'action', label: 'Admin Actions' },
];

export function ActivityTimeline() {
  const [typeFilter, setTypeFilter] = useState<ActivityType | 'all'>('all');
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading, error } = useQuery({
    queryKey: ['activity', typeFilter, page],
    queryFn: () =>
      api.getActivity({
        page,
        limit,
        type: typeFilter === 'all' ? undefined : typeFilter,
      }),
  });

  const totalPages = data ? Math.ceil(data.totalCount / limit) : 0;

  if (isLoading) {
    return <ActivitySkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-destructive font-medium">Failed to load activity</p>
        <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {typeFilters.map((f) => (
          <Button
            key={f.value}
            variant={typeFilter === f.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setTypeFilter(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-lg border">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-8 p-3" />
              <th className="p-3 text-left text-sm font-medium">Time</th>
              <th className="p-3 text-left text-sm font-medium">Type</th>
              <th className="p-3 text-left text-sm font-medium">Summary</th>
              <th className="p-3 text-left text-sm font-medium hidden sm:table-cell">Trigger</th>
            </tr>
          </thead>
          <tbody>
            {!data?.items.length ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No activity found
                </td>
              </tr>
            ) : (
              data.items.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.items.length} of ${data.totalCount} entries` : ''}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);

  const timeStr = formatDateTime(entry.timestamp);

  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-3 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </td>
        <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{timeStr}</td>
        <td className="p-3">
          {entry.type === 'sync' ? (
            <Badge variant="secondary" className="gap-1">
              <RefreshCw className="h-3 w-3" />
              Sync
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Zap className="h-3 w-3" />
              Action
            </Badge>
          )}
        </td>
        <td className="p-3 text-sm">{entry.summary}</td>
        <td className="p-3 text-sm text-muted-foreground hidden sm:table-cell">
          <Badge variant="outline" className="gap-1 font-normal">
            <Clock className="h-3 w-3" />
            {entry.trigger}
          </Badge>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b last:border-0">
          <td colSpan={5} className="bg-muted/20 px-6 py-4">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-auto max-h-64">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="rounded-lg border">
        <div className="border-b bg-muted/50 p-3">
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b p-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
