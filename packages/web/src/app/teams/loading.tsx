import { Skeleton } from '@/components/ui/skeleton';

export default function TeamsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-80 mt-2" />
        <Skeleton className="h-px w-full mt-4" />
      </div>
      <div className="space-y-4">
        <div className="flex gap-3">
          <Skeleton className="h-9 flex-1 max-w-sm" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="rounded-lg border">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 border-b p-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
