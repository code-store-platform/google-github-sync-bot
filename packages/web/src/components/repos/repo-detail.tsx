'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import type { RepoTeamPermission } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { VisibilityBadge } from './visibility-badge';
import { PermissionBadge } from './permission-badge';
import { LanguageBadge } from './language-badge';
import { TeamAutocomplete } from './team-autocomplete';

export function RepoDetail({ name }: { name: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: repo,
    isLoading: repoLoading,
    error: repoError,
  } = useQuery({
    queryKey: ['repo', name],
    queryFn: () => api.getRepo(name),
  });

  const {
    data: repoTeams,
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ['repo-teams', name],
    queryFn: () => api.getRepoTeams(name),
  });

  const { data: allTeams } = useQuery({
    queryKey: ['teams'],
    queryFn: api.getTeams,
  });

  if (repoLoading || teamsLoading) {
    return <RepoDetailSkeleton />;
  }

  if (repoError || !repo) {
    return (
      <div className="space-y-4">
        <Link
          href="/repos"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to repositories
        </Link>
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
          <p className="text-destructive font-medium">Failed to load repository</p>
          <p className="text-sm text-muted-foreground mt-1">
            {repoError?.message || 'Repository not found'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/repos"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to repositories
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold leading-none">{repo.name}</h2>
          <VisibilityBadge visibility={repo.visibility} />
          {repo.archived && <Badge variant="secondary">Archived</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">{repo.fullName}</p>
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        <RepoInfoCard name={name} repo={repo} toast={toast} queryClient={queryClient} />
        <RepoTeamsCard
          name={name}
          teams={repoTeams || []}
          teamsError={teamsError}
          allTeams={allTeams || []}
          toast={toast}
          queryClient={queryClient}
        />
      </div>
    </div>
  );
}

function RepoInfoCard({
  name,
  repo,
  toast,
  queryClient,
}: {
  name: string;
  repo: NonNullable<Awaited<ReturnType<typeof api.getRepo>>>;
  toast: ReturnType<typeof useToast>['toast'];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [editDescription, setEditDescription] = useState(repo.description || '');
  const [editHomepage, setEditHomepage] = useState(repo.homepage || '');
  const [editVisibility, setEditVisibility] = useState(repo.visibility);
  const [editArchived, setEditArchived] = useState(repo.archived);
  const [editTopics, setEditTopics] = useState(repo.topics.join(', '));
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => {
      const topics = editTopics
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      return api.updateRepo(name, {
        description: editDescription,
        homepage: editHomepage,
        visibility: editVisibility,
        archived: editArchived,
        topics,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo', name] });
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      setShowUpdateConfirm(false);
      toast({ title: 'Repository updated', description: `"${name}" has been updated.` });
    },
    onError: (err) => {
      toast({
        title: 'Failed to update repository',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const hasChanges =
    editDescription !== (repo.description || '') ||
    editHomepage !== (repo.homepage || '') ||
    editVisibility !== repo.visibility ||
    editArchived !== repo.archived ||
    editTopics !== repo.topics.join(', ');

  const isFieldsDisabled = editArchived;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repository Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Read-only stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 text-sm">
              <p className="font-medium">Stars</p>
              <p className="text-muted-foreground">{repo.stargazersCount}</p>
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Forks</p>
              <p className="text-muted-foreground">{repo.forksCount}</p>
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Open Issues</p>
              <p className="text-muted-foreground">{repo.openIssuesCount}</p>
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Default Branch</p>
              <p className="text-muted-foreground font-mono text-xs">{repo.defaultBranch}</p>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Language</p>
            <LanguageBadge language={repo.language} />
            {!repo.language && <p className="text-muted-foreground">-</p>}
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">License</p>
            <p className="text-muted-foreground">{repo.license || 'None'}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Created</p>
            <p className="text-muted-foreground">
              {formatDate(repo.createdAt)}
            </p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-medium">Last updated</p>
            <p className="text-muted-foreground">
              {formatDate(repo.updatedAt)}
            </p>
          </div>

          <Separator />

          {/* Edit form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowUpdateConfirm(true);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                disabled={isFieldsDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-homepage">Homepage</Label>
              <Input
                id="edit-homepage"
                value={editHomepage}
                onChange={(e) => setEditHomepage(e.target.value)}
                placeholder="https://..."
                disabled={isFieldsDisabled}
              />
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={editVisibility === 'public' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditVisibility('public')}
                  disabled={isFieldsDisabled}
                >
                  Public
                </Button>
                <Button
                  type="button"
                  variant={editVisibility === 'private' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditVisibility('private')}
                  disabled={isFieldsDisabled}
                >
                  Private
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Archived</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={!editArchived ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditArchived(false)}
                >
                  Active
                </Button>
                <Button
                  type="button"
                  variant={editArchived ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEditArchived(true)}
                >
                  Archived
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-topics">Topics</Label>
              <Input
                id="edit-topics"
                value={editTopics}
                onChange={(e) => setEditTopics(e.target.value)}
                placeholder="topic1, topic2, topic3"
                disabled={isFieldsDisabled}
              />
              {editTopics && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {editTopics
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((topic) => (
                      <Badge key={topic} variant="secondary" className="text-xs">
                        {topic}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
            <Button type="submit" disabled={!hasChanges || updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Update Confirmation Dialog */}
      <Dialog open={showUpdateConfirm} onOpenChange={setShowUpdateConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Repository Update</DialogTitle>
            <DialogDescription>
              You are about to update <strong>{name}</strong>. This will modify the repository on
              GitHub.
              {editVisibility !== repo.visibility && (
                <>
                  <br />
                  <br />
                  <strong className="text-amber-600">
                    Warning: You are changing visibility from {repo.visibility} to {editVisibility}.
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpdateConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RepoTeamsCard({
  name,
  teams,
  teamsError,
  allTeams,
  toast,
  queryClient,
}: {
  name: string;
  teams: Awaited<ReturnType<typeof api.getRepoTeams>>;
  teamsError: Error | null;
  allTeams: Awaited<ReturnType<typeof api.getTeams>>;
  toast: ReturnType<typeof useToast>['toast'];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [teamSlug, setTeamSlug] = useState('');
  const [permission, setPermission] = useState<RepoTeamPermission>('push');
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const existingTeams = useMemo(() => new Set(teams.map((t) => t.slug)), [teams]);

  const addMutation = useMutation({
    mutationFn: () => api.addRepoTeamAccess(name, teamSlug.trim(), permission),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repo-teams', name] });
      toast({ title: 'Team access added', description: `${teamSlug} now has ${permission} access.` });
      setTeamSlug('');
      setPermission('push');
    },
    onError: (err) => {
      toast({
        title: 'Failed to add team access',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (target: string) => api.removeRepoTeamAccess(name, target),
    onSuccess: (_, target) => {
      queryClient.invalidateQueries({ queryKey: ['repo-teams', name] });
      setRemoveTarget(null);
      toast({
        title: 'Team access removed',
        description: `${target} no longer has access.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Failed to remove team access',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const permissionOptions: RepoTeamPermission[] = ['pull', 'triage', 'push', 'maintain', 'admin'];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add team form */}
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
                teams={allTeams}
                existingTeams={existingTeams}
              />
              <Button type="submit" size="sm" disabled={!teamSlug.trim() || addMutation.isPending}>
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {permissionOptions.map((p) => (
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

          {/* Team list */}
          {teamsError ? (
            <p className="text-sm text-destructive">Failed to load teams</p>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No team access</p>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => (
                <div key={team.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/teams/${team.slug}`}
                      className="text-sm font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {team.name}
                    </Link>
                    <p className="text-xs text-muted-foreground font-mono">{team.slug}</p>
                  </div>
                  <PermissionBadge permission={team.permission} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setRemoveTarget(team.slug)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remove team confirmation */}
      <Dialog open={!!removeTarget} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Team Access</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove <strong>{removeTarget}</strong> from this repository?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeTarget && removeMutation.mutate(removeTarget)}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RepoDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}
