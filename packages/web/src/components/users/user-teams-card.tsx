'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { PrivacyBadge } from '@/components/teams/privacy-badge';
import { RoleBadge } from '@/components/teams/role-badge';
import { TeamAutocomplete } from './team-autocomplete';
import type {
  UserDetail,
  TeamMemberRole,
  UserTeamMembership,
  UserReposResponse,
} from '@/lib/types';

export function UserTeamsCard({ user }: { user: UserDetail }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [teamSlug, setTeamSlug] = useState('');
  const [role, setRole] = useState<TeamMemberRole>('member');

  const {
    data: userTeams,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['user-teams', user.email],
    queryFn: () => api.getUserTeams(user.email),
    enabled: !!user.githubUsername,
  });

  const { data: allTeams } = useQuery({
    queryKey: ['teams'],
    queryFn: api.getTeams,
    enabled: !!user.githubUsername,
  });

  const existingTeamSlugs = useMemo(
    () => new Set((userTeams ?? []).map((t) => t.slug)),
    [userTeams],
  );

  const userTeamsKey = ['user-teams', user.email] as const;
  const userReposKey = ['user-repos', user.email] as const;
  const teamMutationKey = ['user-team-mutation', user.email] as const;

  const addMutation = useMutation({
    mutationKey: teamMutationKey,
    mutationFn: () =>
      api.addTeamMember(teamSlug.trim(), {
        username: user.githubUsername!,
        role,
      }),
    onMutate: async () => {
      const slug = teamSlug.trim();
      await queryClient.cancelQueries({ queryKey: userTeamsKey });
      const previous = queryClient.getQueryData<UserTeamMembership[]>(userTeamsKey);
      const teamToAdd = (allTeams ?? []).find((t) => t.slug === slug);
      if (teamToAdd) {
        queryClient.setQueryData<UserTeamMembership[]>(userTeamsKey, (current) => [
          ...(current ?? []),
          { ...teamToAdd, role },
        ]);
      }
      return { previous, slug };
    },
    onSuccess: (_, _vars, context) => {
      toast({
        title: 'Added to team',
        description: `${user.githubUsername} has been added to ${context.slug}.`,
      });
      setTeamSlug('');
      setRole('member');
    },
    onError: (err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(userTeamsKey, context.previous);
      }
      toast({
        title: 'Failed to add to team',
        description: err.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userTeamsKey });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['user-repos', user.email] });
    },
  });

  const removeMutation = useMutation({
    mutationKey: teamMutationKey,
    mutationFn: (slug: string) => api.removeTeamMember(slug, user.githubUsername!),
    onMutate: async (slug: string) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: userTeamsKey }),
        queryClient.cancelQueries({ queryKey: userReposKey }),
      ]);
      const previousTeams = queryClient.getQueryData<UserTeamMembership[]>(userTeamsKey);
      const previousRepos = queryClient.getQueryData<UserReposResponse>(userReposKey);
      queryClient.setQueryData<UserTeamMembership[]>(userTeamsKey, (current) =>
        (current ?? []).filter((t) => t.slug !== slug),
      );
      queryClient.setQueryData<UserReposResponse>(userReposKey, (current) =>
        current
          ? { ...current, teams: current.teams.filter((r) => r.teamSlug !== slug) }
          : current,
      );
      return { previousTeams, previousRepos };
    },
    onSuccess: (_, slug) => {
      toast({
        title: 'Removed from team',
        description: `${user.githubUsername} has been removed from ${slug}.`,
      });
    },
    onError: (err, _slug, context) => {
      if (context?.previousTeams !== undefined) {
        queryClient.setQueryData(userTeamsKey, context.previousTeams);
      }
      if (context?.previousRepos !== undefined) {
        queryClient.setQueryData(userReposKey, context.previousRepos);
      }
      toast({
        title: 'Failed to remove from team',
        description: err.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userTeamsKey });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      // GitHub's repo-access read is eventually-consistent after a team
      // removal — refetching now would overwrite the optimistic filter with
      // stale data. Mark stale only; refetch happens on next mount/focus.
      queryClient.invalidateQueries({ queryKey: userReposKey, refetchType: 'none' });
    },
  });

  if (!user.githubUsername) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Set a GitHub username to manage team memberships.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Teams</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add to team form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!teamSlug.trim()) return;
            addMutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="flex gap-2">
            <TeamAutocomplete
              value={teamSlug}
              onChange={setTeamSlug}
              teams={allTeams ?? []}
              existingTeamSlugs={existingTeamSlugs}
            />
            <Button type="submit" size="sm" disabled={!teamSlug.trim() || addMutation.isPending}>
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={role === 'member' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRole('member')}
            >
              Member
            </Button>
            <Button
              type="button"
              variant={role === 'maintainer' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRole('maintainer')}
            >
              Maintainer
            </Button>
          </div>
        </form>

        <Separator />

        {/* Teams list */}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load teams</p>
        ) : !userTeams || userTeams.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Not a member of any teams
          </p>
        ) : (
          <div className="space-y-2">
            {userTeams.map((team) => (
              <div key={team.slug} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/teams/${team.slug}`}
                      className="text-sm font-medium hover:underline truncate"
                    >
                      {team.name}
                    </Link>
                    <PrivacyBadge privacy={team.privacy} />
                  </div>
                  {team.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {team.description}
                    </p>
                  )}
                </div>
                <RoleBadge role={team.role} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeMutation.mutate(team.slug)}
                  disabled={removeMutation.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
