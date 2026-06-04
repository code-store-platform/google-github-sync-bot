'use client';

import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PermissionBadge } from '@/components/repos/permission-badge';
import { RepoAutocomplete } from './repo-autocomplete';
import type { UserDetail, RepoTeamPermission } from '@/lib/types';

const PERMISSIONS: RepoTeamPermission[] = ['pull', 'triage', 'push', 'maintain', 'admin'];

export function UserReposCard({ user }: { user: UserDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [repoName, setRepoName] = useState('');
  const [permission, setPermission] = useState<RepoTeamPermission>('push');

  const {
    data: userRepos,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ['user-repos', user.email],
    queryFn: () => api.getUserRepos(user.email),
    enabled: !!user.githubUsername,
  });

  const teamMutationsInFlight = useIsMutating({
    mutationKey: ['user-team-mutation', user.email],
  });
  const teamAccessSyncing =
    teamMutationsInFlight > 0 || (isFetching && !isLoading);

  const { data: allRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: api.getRepos,
    enabled: !!user.githubUsername,
  });

  const existingDirectRepoNames = useMemo(
    () => new Set((userRepos?.direct ?? []).map((r) => r.name)),
    [userRepos],
  );

  const addMutation = useMutation({
    mutationFn: () =>
      api.addRepoCollaborator(repoName.trim(), user.githubUsername!, permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-repos', user.email] });
      toast({
        title: 'Collaborator added',
        description: `${user.githubUsername} added to ${repoName} with ${permission} access.`,
      });
      setRepoName('');
      setPermission('push');
    },
    onError: (err) => {
      toast({
        title: 'Failed to add collaborator',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (repo: string) => api.removeRepoCollaborator(repo, user.githubUsername!),
    onSuccess: (_, repo) => {
      queryClient.invalidateQueries({ queryKey: ['user-repos', user.email] });
      toast({
        title: 'Collaborator removed',
        description: `${user.githubUsername} removed from ${repo}.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to remove collaborator',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  if (!user.githubUsername) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repositories</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Set a GitHub username to manage repository access.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repositories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Direct Access Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">Direct Access</h4>

          {/* Add collaborator form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!repoName.trim()) return;
              addMutation.mutate();
            }}
            className="space-y-3"
          >
            <div className="flex gap-2">
              <RepoAutocomplete
                value={repoName}
                onChange={setRepoName}
                repos={allRepos ?? []}
                existingRepoNames={existingDirectRepoNames}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!repoName.trim() || addMutation.isPending}
              >
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {PERMISSIONS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={permission === p ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPermission(p)}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
          </form>

          <Separator />

          {/* Direct repos list */}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load repositories</p>
          ) : !userRepos?.direct.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No direct repository access
            </p>
          ) : (
            <div className="space-y-2">
              {userRepos.direct.map((repo) => (
                <div
                  key={repo.name}
                  className="flex items-center gap-3 rounded-lg border p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/repos/${repo.name}`}
                      className="text-sm font-medium font-mono hover:underline"
                    >
                      {repo.name}
                    </Link>
                    {repo.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {repo.description}
                      </p>
                    )}
                  </div>
                  <PermissionBadge permission={repo.permission} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeMutation.mutate(repo.name)}
                    disabled={removeMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Team Access Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">Team Access</h4>
            {teamAccessSyncing && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing…
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load repositories</p>
          ) : !userRepos?.teams.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No repository access via teams
            </p>
          ) : (
            <div className="space-y-2">
              {userRepos.teams.map((repo) => (
                <div
                  key={`${repo.teamSlug}-${repo.name}`}
                  className="flex items-center gap-3 rounded-lg border p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/repos/${repo.name}`}
                      className="text-sm font-medium font-mono hover:underline"
                    >
                      {repo.name}
                    </Link>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      via{' '}
                      <Link
                        href={`/teams/${repo.teamSlug}`}
                        className="hover:underline"
                      >
                        {repo.teamName}
                      </Link>
                    </p>
                  </div>
                  <PermissionBadge permission={repo.permission} />
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
